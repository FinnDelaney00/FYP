"""Offline evaluation tests for the forecasting and anomaly-detection models."""

import math
import os
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

from tests.helpers import FakeS3Client, REPO_ROOT, load_module


REPORTS_DIR = REPO_ROOT / "tests" / "artifacts"
RUN_INDEX_PATH = REPORTS_DIR / "ml_model_evaluation_report_index.txt"


class MLModelEvaluationTests(unittest.TestCase):
    """Backtest forecasting quality and score anomaly precision/recall on labelled samples."""

    @classmethod
    def setUpClass(cls):
        """Load both ML lambdas once and prepare optional report-writing metadata."""

        cls.run_started_at = datetime.now(timezone.utc)
        cls.write_reports = str(os.environ.get("SMARTSTREAM_WRITE_ML_EVAL_REPORTS", "false")).strip().lower() == "true"
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
        """Persist the collected evaluation report when report writing is enabled."""

        if not cls.write_reports:
            return
        cls.report_path.write_text("\n\n".join(cls.report_sections) + "\n", encoding="utf-8")
        with RUN_INDEX_PATH.open("a", encoding="utf-8") as index_file:
            index_file.write(f"{cls.run_started_at.isoformat()} {cls.report_path.name}\n")

    def test_forecasting_backtest_metrics(self):
        """Forecasts should stay within the tolerated error bounds on synthetic holdout data."""

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
        """Anomaly detection should achieve acceptable precision and recall on labelled samples."""

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
            (
                "Method: mixed-severity finance samples with seasonality, clustered events, and borderline cases "
                "labelled as normal/anomalous, then compared with IsolationForest results."
            ),
            "Transaction-level labelled sample:",
            f"  Records evaluated={len(transaction_records)}",
            f"  Mode used by Lambda={transaction_result['metadata']['mode']}",
            f"  Labelled anomalies={sorted(transaction_labels)}",
            f"  Predicted anomalies={sorted(item['record_id'] for item in transaction_result['anomalies'])}",
            f"  Precision={transaction_metrics['precision']:.3f}",
            f"  Recall={transaction_metrics['recall']:.3f}",
            f"  F1-score={transaction_metrics['f1_score']:.3f}",
            f"  TP={int(transaction_metrics['true_positives'])} FP={int(transaction_metrics['false_positives'])} FN={int(transaction_metrics['false_negatives'])}",
            "Daily aggregate labelled sample:",
            f"  Records evaluated={len(daily_records)}",
            f"  Mode used by Lambda={daily_result['metadata']['mode']}",
            f"  Labelled anomalies={sorted(daily_labels)}",
            f"  Predicted anomalies={sorted(item['record_id'] for item in daily_result['anomalies'])}",
            f"  Precision={daily_metrics['precision']:.3f}",
            f"  Recall={daily_metrics['recall']:.3f}",
            f"  F1-score={daily_metrics['f1_score']:.3f}",
            f"  TP={int(daily_metrics['true_positives'])} FP={int(daily_metrics['false_positives'])} FN={int(daily_metrics['false_negatives'])}",
            "Overall anomaly metrics:",
            f"  Precision={overall_metrics['precision']:.3f}",
            f"  Recall={overall_metrics['recall']:.3f}",
            f"  F1-score={overall_metrics['f1_score']:.3f}",
            f"  TP={int(overall_metrics['true_positives'])} FP={int(overall_metrics['false_positives'])} FN={int(overall_metrics['false_negatives'])}",
        ]
        self.report_sections.append("\n".join(lines))

        self.assertEqual(transaction_result["metadata"]["mode"], "transaction")
        self.assertEqual(daily_result["metadata"]["mode"], "daily")
        self.assertGreaterEqual(transaction_metrics["precision"], 0.7)
        self.assertGreaterEqual(transaction_metrics["recall"], 0.8)
        self.assertGreaterEqual(transaction_metrics["f1_score"], 0.75)
        self.assertGreaterEqual(daily_metrics["precision"], 0.95)
        self.assertGreaterEqual(daily_metrics["recall"], 0.65)
        self.assertGreaterEqual(daily_metrics["f1_score"], 0.8)
        self.assertGreaterEqual(overall_metrics["precision"], 0.75)
        self.assertGreaterEqual(overall_metrics["recall"], 0.75)
        self.assertGreaterEqual(overall_metrics["f1_score"], 0.75)

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
        """Train a forecaster on synthetic history and compute holdout error metrics."""

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
        """Generate train and holdout time series with trend and weekday seasonality."""

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
        """Create transaction records plus the ids that should be treated as anomalies."""

        records: List[Dict[str, Any]] = []
        labelled_anomalies = {
            "anomaly-major-1",
            "anomaly-major-2",
            "anomaly-cluster-1",
            "anomaly-cluster-2",
            "anomaly-borderline-1",
            "anomaly-borderline-2",
        }
        start_date = date(2026, 1, 1)

        for offset in range(70):
            current_date = start_date + timedelta(days=offset)
            weekday = current_date.weekday()
            base_amount = 95 + (weekday * 5) + ((offset % 3) * 2)
            records.append(
                {
                    "transaction_id": f"norm-{offset + 1}",
                    "transaction_date": current_date.isoformat(),
                    "amount": base_amount,
                    "type": "expense",
                    "manual_label": "normal",
                }
            )
            if offset % 6 == 0:
                records.append(
                    {
                        "transaction_id": f"norm-extra-{offset + 1}",
                        "transaction_date": current_date.isoformat(),
                        "amount": round(base_amount * 0.9, 2),
                        "type": "expense",
                        "manual_label": "normal",
                    }
                )

        anomaly_rows = [
            ("anomaly-major-1", 18, 780),
            ("anomaly-major-2", 33, 920),
            ("anomaly-cluster-1", 45, 360),
            ("anomaly-cluster-2", 45, 340),
            ("anomaly-borderline-1", 52, 240),
            ("anomaly-borderline-2", 61, 255),
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
        """Create daily revenue-like samples and expected aggregate anomaly identifiers."""

        records: List[Dict[str, Any]] = []
        labelled_anomalies = {
            "revenue-2026-02-06",
            "revenue-2026-02-10",
            "revenue-2026-02-16",
        }
        start_date = date(2026, 2, 1)

        for offset in range(19):
            current_date = start_date + timedelta(days=offset)
            amount = 980 + (current_date.weekday() * 24) + ((offset % 4) * 18)
            record_id = f"day-{offset + 1}"
            label = "normal"

            if offset == 5:
                amount = 250
                record_id = "rev-drop-major-1"
                label = "anomalous"
            elif offset == 9:
                amount = 320
                record_id = "rev-drop-subtle"
                label = "anomalous"
            elif offset == 15:
                amount = 1450
                record_id = "rev-spike-major-1"
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
        """Compute precision, recall, and F1 from labelled and predicted anomaly ids."""

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
