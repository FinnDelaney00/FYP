import math
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from tests.helpers import FakeS3Client, REPO_ROOT, load_module


REPORTS_DIR = REPO_ROOT / "tests" / "artifacts"
RUN_INDEX_PATH = REPORTS_DIR / "ml_model_evaluation_report_index.txt"


class MLModelEvaluationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_started_at = datetime.now(timezone.utc)
        cls.report_path = REPORTS_DIR / (
            f"ml_model_evaluation_report_{cls.run_started_at.strftime('%Y%m%dT%H%M%S%fZ')}.txt"
        )
        cls.forecast_module = load_module(
            relative_path="smartstream-terraform/lambdas/ml/lambda_function.py",
            module_name="ml_model_evaluation_forecast_module",
            fake_s3_client=FakeS3Client(),
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/smartstream-dev/",
                "ANALYTICS_PREFIX": "trusted-analytics/smartstream-dev/predictions/",
                "MAX_INPUT_FILES": "20",
                "FORECAST_DAYS": "7",
            },
        )
        cls.anomaly_module = load_module(
            relative_path="smartstream-terraform/lambdas/anomaly/lambda_function.py",
            module_name="ml_model_evaluation_anomaly_module",
            fake_s3_client=FakeS3Client(),
            env={
                "DATA_LAKE_BUCKET": "test-data-lake",
                "TRUSTED_PREFIX": "trusted/smartstream-dev/",
                "FINANCE_PREFIX": "trusted/smartstream-dev/finance/",
                "TRANSACTIONS_PREFIX": "trusted/smartstream-dev/finance/transactions/",
                "ANALYTICS_PREFIX": "trusted-analytics/smartstream-dev/anomalies/",
                "MAX_INPUT_FILES": "20",
            },
        )
        cls.report_sections: List[str] = [
            "ML Model Evaluation Report",
            f"Generated at: {cls.run_started_at.isoformat()}",
            f"Report file: {cls.report_path.name}",
        ]
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.report_path.write_text("\n\n".join(cls.report_sections) + "\n", encoding="utf-8")
        with RUN_INDEX_PATH.open("a", encoding="utf-8") as index_file:
            index_file.write(f"{cls.run_started_at.isoformat()} {cls.report_path.name}\n")

    def test_forecasting_backtest_metrics(self):
        forecast_specs = [
            {
                "metric_name": "employee_headcount",
                "prediction_field": "predicted_headcount",
                "base": 120.0,
                "trend": 0.4,
                "weekly_pattern": [0, 1, 1, 2, 2, 3, 3],
                "integer_output": True,
                "carry_forward": True,
                "mae_limit": 3.0,
                "rmse_limit": 4.0,
                "mape_limit": 3.0,
            },
            {
                "metric_name": "revenue",
                "prediction_field": "predicted_revenue",
                "base": 1400.0,
                "trend": 12.0,
                "weekly_pattern": [30, -20, 10, 40, 60, 90, 50],
                "integer_output": False,
                "carry_forward": False,
                "mae_limit": 80.0,
                "rmse_limit": 90.0,
                "mape_limit": 5.0,
            },
            {
                "metric_name": "expenditure",
                "prediction_field": "predicted_expenditure",
                "base": 700.0,
                "trend": 8.0,
                "weekly_pattern": [15, 20, 10, 25, 35, 55, 30],
                "integer_output": False,
                "carry_forward": False,
                "mae_limit": 50.0,
                "rmse_limit": 60.0,
                "mape_limit": 5.0,
            },
        ]

        lines = ["Forecasting Backtest", "Method: train on 60 days, forecast next 7 days, compare against holdout."]
        for spec in forecast_specs:
            metrics = self.evaluate_forecast_series(**spec)
            lines.extend(
                [
                    f"{spec['metric_name']}:",
                    f"  MAE={metrics['mae']:.2f}",
                    f"  RMSE={metrics['rmse']:.2f}",
                    f"  MAPE={metrics['mape']:.2f}%",
                    f"  Actual={metrics['actual']}",
                    f"  Predicted={metrics['predicted']}",
                ]
            )

            self.assertLessEqual(metrics["mae"], spec["mae_limit"])
            self.assertLessEqual(metrics["rmse"], spec["rmse_limit"])
            self.assertLessEqual(metrics["mape"], spec["mape_limit"])

        self.report_sections.append("\n".join(lines))

    def test_manual_labelled_anomaly_precision_recall_f1(self):
        transaction_records, transaction_labels = self.build_manual_labelled_transaction_sample()
        daily_records, daily_labels = self.build_manual_labelled_daily_sample()

        transaction_result = self.anomaly_module.detect_finance_anomalies(
            transaction_records,
            detected_at=datetime.now(timezone.utc),
        )
        daily_result = self.anomaly_module.detect_finance_anomalies(
            daily_records,
            detected_at=datetime.now(timezone.utc),
        )

        transaction_metrics = self.compute_classification_metrics(
            labelled_positive_ids=transaction_labels,
            predicted_positive_ids={item["record_id"] for item in transaction_result["anomalies"]},
        )
        daily_metrics = self.compute_classification_metrics(
            labelled_positive_ids=daily_labels,
            predicted_positive_ids={item["record_id"] for item in daily_result["anomalies"]},
        )
        overall_metrics = self.compute_classification_metrics(
            labelled_positive_ids={f"tx:{item}" for item in transaction_labels} | {f"day:{item}" for item in daily_labels},
            predicted_positive_ids={f"tx:{item['record_id']}" for item in transaction_result["anomalies"]}
            | {f"day:{item['record_id']}" for item in daily_result["anomalies"]},
        )

        lines = [
            "Manual Labelled Anomaly Evaluation",
            "Method: manual finance sample labelled as normal/anomalous, then compared with IsolationForest results.",
            "Transaction-level labelled sample:",
            f"  Mode used by Lambda={transaction_result['metadata']['mode']}",
            f"  Labelled anomalies={sorted(transaction_labels)}",
            f"  Predicted anomalies={sorted(item['record_id'] for item in transaction_result['anomalies'])}",
            f"  Precision={transaction_metrics['precision']:.3f}",
            f"  Recall={transaction_metrics['recall']:.3f}",
            f"  F1-score={transaction_metrics['f1_score']:.3f}",
            "Daily aggregate labelled sample:",
            f"  Mode used by Lambda={daily_result['metadata']['mode']}",
            f"  Labelled anomalies={sorted(daily_labels)}",
            f"  Predicted anomalies={sorted(item['record_id'] for item in daily_result['anomalies'])}",
            f"  Precision={daily_metrics['precision']:.3f}",
            f"  Recall={daily_metrics['recall']:.3f}",
            f"  F1-score={daily_metrics['f1_score']:.3f}",
            "Overall anomaly metrics:",
            f"  Precision={overall_metrics['precision']:.3f}",
            f"  Recall={overall_metrics['recall']:.3f}",
            f"  F1-score={overall_metrics['f1_score']:.3f}",
        ]
        self.report_sections.append("\n".join(lines))

        self.assertEqual(transaction_result["metadata"]["mode"], "transaction")
        self.assertEqual(daily_result["metadata"]["mode"], "daily")
        self.assertGreaterEqual(transaction_metrics["precision"], 0.8)
        self.assertGreaterEqual(transaction_metrics["recall"], 0.8)
        self.assertGreaterEqual(transaction_metrics["f1_score"], 0.8)
        self.assertGreaterEqual(daily_metrics["precision"], 0.8)
        self.assertGreaterEqual(daily_metrics["recall"], 0.8)
        self.assertGreaterEqual(daily_metrics["f1_score"], 0.8)
        self.assertGreaterEqual(overall_metrics["precision"], 0.85)
        self.assertGreaterEqual(overall_metrics["recall"], 0.85)
        self.assertGreaterEqual(overall_metrics["f1_score"], 0.85)

    @classmethod
    def evaluate_forecast_series(
        cls,
        *,
        metric_name: str,
        prediction_field: str,
        base: float,
        trend: float,
        weekly_pattern: Sequence[float],
        integer_output: bool,
        carry_forward: bool,
        mae_limit: float,
        rmse_limit: float,
        mape_limit: float,
    ) -> Dict[str, Any]:
        del mae_limit, rmse_limit, mape_limit
        train_values, holdout_values = cls.build_forecast_series(
            base=base,
            trend=trend,
            weekly_pattern=weekly_pattern,
            integer_output=integer_output,
        )
        series = cls.forecast_module.build_daily_series(
            values_by_date=train_values,
            carry_forward=carry_forward,
        )
        training_frame = cls.forecast_module.build_forecast_training_frame(series)
        model, model_metadata = cls.forecast_module.train_random_forest_forecaster(training_frame)
        forecast_rows = cls.forecast_module.recursive_forecast(
            history_series=series,
            model=model,
            forecast_days=len(holdout_values),
            metric_name=metric_name,
            prediction_field=prediction_field,
            integer_output=integer_output,
            model_metadata=model_metadata,
        )

        actual_values = [float(value) for value in holdout_values.values()]
        predicted_values = [float(row[prediction_field]) for row in forecast_rows]
        mae = sum(abs(actual - predicted) for actual, predicted in zip(actual_values, predicted_values)) / len(actual_values)
        rmse = math.sqrt(
            sum((actual - predicted) ** 2 for actual, predicted in zip(actual_values, predicted_values)) / len(actual_values)
        )
        mape = (
            sum(
                abs((actual - predicted) / actual)
                for actual, predicted in zip(actual_values, predicted_values)
                if actual != 0
            )
            / len(actual_values)
            * 100.0
        )

        return {
            "actual": [int(round(value)) if integer_output else round(value, 2) for value in actual_values],
            "predicted": [int(round(value)) if integer_output else round(value, 2) for value in predicted_values],
            "mae": mae,
            "rmse": rmse,
            "mape": mape,
        }

    @staticmethod
    def build_forecast_series(
        *,
        base: float,
        trend: float,
        weekly_pattern: Sequence[float],
        integer_output: bool,
        train_days: int = 60,
        holdout_days: int = 7,
    ) -> Tuple[Dict[date, float], Dict[date, float]]:
        start_date = date(2026, 1, 1)
        all_values: Dict[date, float] = {}

        for offset in range(train_days + holdout_days):
            current_date = start_date + timedelta(days=offset)
            value = base + (trend * offset) + weekly_pattern[current_date.weekday()]
            if integer_output:
                value = round(value)
            all_values[current_date] = float(value)

        items = list(all_values.items())
        train_values = dict(items[:train_days])
        holdout_values = dict(items[train_days:])
        return train_values, holdout_values

    @staticmethod
    def build_manual_labelled_transaction_sample() -> Tuple[List[Dict[str, Any]], set[str]]:
        records: List[Dict[str, Any]] = []
        labelled_anomalies = {
            "anomaly-amount-1",
            "anomaly-amount-2",
            "anomaly-spike-1",
            "anomaly-spike-2",
        }
        start_date = date(2026, 1, 1)
        skipped_normal_days = {12, 20, 27}

        for offset in range(40):
            if offset in skipped_normal_days:
                continue
            current_date = start_date + timedelta(days=offset)
            records.append(
                {
                    "transaction_id": f"norm-{offset + 1}",
                    "transaction_date": current_date.isoformat(),
                    "amount": 100 + ((offset % 5) * 4),
                    "type": "expense",
                    "manual_label": "normal",
                }
            )

        anomaly_rows = [
            ("anomaly-amount-1", 12, 1400),
            ("anomaly-amount-2", 20, 1650),
            ("anomaly-spike-1", 27, 900),
            ("anomaly-spike-2", 27, 850),
        ]
        for record_id, offset, amount in anomaly_rows:
            current_date = start_date + timedelta(days=offset)
            records.append(
                {
                    "transaction_id": record_id,
                    "transaction_date": current_date.isoformat(),
                    "amount": amount,
                    "type": "expense",
                    "manual_label": "anomalous",
                }
            )

        return records, labelled_anomalies

    @staticmethod
    def build_manual_labelled_daily_sample() -> Tuple[List[Dict[str, Any]], set[str]]:
        records: List[Dict[str, Any]] = []
        labelled_anomalies = {
            "revenue-2026-02-10",
            "revenue-2026-02-16",
        }
        start_date = date(2026, 2, 1)

        for offset in range(18):
            current_date = start_date + timedelta(days=offset)
            amount = 1000 + ((offset % 4) * 20)
            record_id = f"day-{offset + 1}"
            label = "normal"

            if offset == 9:
                amount = 180
                record_id = "rev-drop-1"
                label = "anomalous"
            elif offset == 15:
                amount = 150
                record_id = "rev-drop-2"
                label = "anomalous"

            records.append(
                {
                    "transaction_id": record_id,
                    "transaction_date": current_date.isoformat(),
                    "amount": amount,
                    "type": "sale",
                    "manual_label": label,
                }
            )

        return records, labelled_anomalies

    @staticmethod
    def compute_classification_metrics(
        *,
        labelled_positive_ids: set[str],
        predicted_positive_ids: set[str],
    ) -> Dict[str, float]:
        true_positives = len(labelled_positive_ids & predicted_positive_ids)
        false_positives = len(predicted_positive_ids - labelled_positive_ids)
        false_negatives = len(labelled_positive_ids - predicted_positive_ids)

        precision = true_positives / len(predicted_positive_ids) if predicted_positive_ids else 0.0
        recall = true_positives / len(labelled_positive_ids) if labelled_positive_ids else 0.0
        if precision + recall == 0:
            f1_score = 0.0
        else:
            f1_score = 2 * precision * recall / (precision + recall)

        return {
            "precision": precision,
            "recall": recall,
            "f1_score": f1_score,
            "true_positives": float(true_positives),
            "false_positives": float(false_positives),
            "false_negatives": float(false_negatives),
        }


if __name__ == "__main__":
    unittest.main()
