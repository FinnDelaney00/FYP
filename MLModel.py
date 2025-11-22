import os
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.metrics import accuracy_score, classification_report
from sklearn.cluster import KMeans

from lifelines import KaplanMeierFitter
import shap

# Prophet import
try:
    from prophet import Prophet
except ImportError:
    from fbprophet import Prophet


# ==========================================
# 1. LOAD DATA
# ==========================================
def load_data(csv_path=r"C:\Users\finnd\OneDrive\Documents\FYP\FYP\Employee.csv"):
    df = pd.read_csv(csv_path)
    print(f"Loaded dataset: {df.shape[0]} rows, {df.shape[1]} columns")
    print(df.head())
    return df


# ==========================================
# 2. PREPROCESSING
# ==========================================
def preprocess_for_ml(df):
    df = df.copy()

    # Categorical columns
    categorical_cols = ["Education", "City", "Gender", "EverBenched", "PaymentTier"]
    encoders = {}

    for col in categorical_cols:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col])
        encoders[col] = le

    X = df.drop("LeaveOrNot", axis=1)
    y = df["LeaveOrNot"]

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    return X_scaled, y, encoders, scaler, X.columns.tolist(), df


# ==========================================
# 3. ATTRITION CLASSIFICATION
# ==========================================
def train_attrition_model(X_train, y_train):
    model = RandomForestClassifier(
        n_estimators=200, random_state=42, n_jobs=-1
    )
    model.fit(X_train, y_train)
    return model


def evaluate_attrition_model(model, X_test, y_test):
    print("\n=== ATTRITION CLASSIFICATION ===")
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    print(f"Accuracy: {acc*100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, preds))


# ==========================================
# 4. FEATURE IMPORTANCE (NEW)
# ==========================================
def visualize_feature_importance(model, feature_names):
    importances = model.feature_importances_
    sorted_idx = np.argsort(importances)

    plt.figure(figsize=(8,6))
    plt.barh(np.array(feature_names)[sorted_idx], importances[sorted_idx])
    plt.title("Feature Importance: What Drives Attrition?")
    plt.xlabel("Importance")
    plt.tight_layout()
    plt.show()


# ==========================================
# 5. ANOMALY DETECTION
# ==========================================
def train_anomaly_detector(X_scaled):
    model = IsolationForest(
        n_estimators=200,
        contamination=0.02,
        random_state=42
    )
    model.fit(X_scaled)
    return model


def label_anomalies(df, X_scaled, anomaly_model):
    df = df.copy()
    df["anomaly_label"] = anomaly_model.predict(X_scaled)
    df["anomaly_score"] = anomaly_model.decision_function(X_scaled)

    print("\n=== ANOMALY SUMMARY ===")
    print("Total anomalies:", (df["anomaly_label"] == -1).sum())

    return df


def visualize_anomalies(df):
    sorted_df = df.sort_values("anomaly_score")

    plt.figure(figsize=(10,5))
    plt.plot(sorted_df["anomaly_score"].values)
    plt.axhline(0, color="red", linestyle="--", label="Threshold")
    plt.title("Anomaly Scores (Lower = More Anomalous)")
    plt.xlabel("Employees (sorted)")
    plt.ylabel("Score")
    plt.legend()
    plt.tight_layout()
    plt.show()


# ==========================================
# 6. CLUSTERING (NEW)
# ==========================================
def employee_clustering(X_scaled, df):
    kmeans = KMeans(n_clusters=3, random_state=42)
    df["cluster"] = kmeans.fit_predict(X_scaled)

    plt.figure(figsize=(8,5))
    df.groupby("cluster")["LeaveOrNot"].mean().plot(kind="bar")
    plt.title("Cluster vs Average Attrition Probability")
    plt.xlabel("Cluster")
    plt.ylabel("Avg Leave Probability")
    plt.tight_layout()
    plt.show()

    print("\n=== CLUSTER PROFILES ===")
    print(df.groupby("cluster").mean())

    return df, kmeans


# ==========================================
# 7. SHAP EXPLAINABILITY (NEW)
# ==========================================
def shap_explain(model, X_scaled, feature_names):
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_scaled)

    print("\n=== SHAP SUMMARY PLOT ===")
    shap.summary_plot(shap_values[1], features=X_scaled, feature_names=feature_names)


# ==========================================
# 8. SURVIVAL ANALYSIS (NEW)
# ==========================================
def survival_analysis(df):
    km = KaplanMeierFitter()

    # Tenure proxy = current year - joining year
    df["tenure_years"] = 2025 - df["JoiningYear"]

    km.fit(durations=df["tenure_years"], event_observed=df["LeaveOrNot"])

    km.plot_survival_function()
    plt.title("Employee Retention Curve (Kaplan–Meier)")
    plt.xlabel("Years at Company")
    plt.ylabel("Probability of Staying")
    plt.tight_layout()
    plt.show()


# ==========================================
# 9. FORECASTING WITH PROPHET
# ==========================================
def build_time_series(df):
    yearly = (
        df.groupby("JoiningYear")
          .size()
          .reset_index(name="hires")
          .sort_values("JoiningYear")
    )
    yearly["headcount"] = yearly["hires"].cumsum()
    yearly["ds"] = pd.to_datetime(yearly["JoiningYear"].astype(str) + "-01-01")

    ts = (
        yearly[["ds", "headcount"]]
        .set_index("ds")
        .resample("MS")
        .interpolate("linear")
        .reset_index()
        .rename(columns={"headcount": "y"})
    )
    return ts


def train_forecast_model(ts):
    model = Prophet(yearly_seasonality=True)
    model.fit(ts)
    return model


def forecast_growth(model, ts, months=6):
    future = model.make_future_dataframe(periods=months, freq="MS")
    forecast = model.predict(future)
    summary = forecast.tail(months)[["ds","yhat","yhat_lower","yhat_upper"]]
    print(summary)
    return forecast, summary


def plot_forecast_simple(ts, forecast, months=6):
    plt.figure(figsize=(10,6))

    plt.plot(ts["ds"], ts["y"], label="Historical", linewidth=2)

    future = forecast.tail(months)
    plt.plot(future["ds"], future["yhat"], linestyle="--", label="Forecast")

    plt.fill_between(
        future["ds"],
        future["yhat_lower"],
        future["yhat_upper"],
        alpha=0.2,
        label="Range"
    )

    plt.title("Employee Growth Forecast")
    plt.xlabel("Date")
    plt.ylabel("Headcount")
    plt.legend()
    plt.tight_layout()
    plt.show()


# ==========================================
# 10. SAVE ARTIFACTS
# ==========================================
def save_artifacts(path, models_dict):
    os.makedirs(path, exist_ok=True)

    for name, obj in models_dict.items():
        joblib.dump(obj, os.path.join(path, f"{name}.pkl"))

    print(f"\nSaved all artifacts to: {path}")


# ==========================================
# 11. MAIN
# ==========================================
def main():
    df_raw = load_data()

    # ML preprocessing
    X_scaled, y, encoders, scaler, features, df = preprocess_for_ml(df_raw)

    # Train attrition model
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    clf = train_attrition_model(X_train, y_train)
    evaluate_attrition_model(clf, X_test, y_test)

    # Feature importance
    visualize_feature_importance(clf, features)

    # Anomaly detection
    anom = train_anomaly_detector(X_scaled)
    df = label_anomalies(df, X_scaled, anom)
    visualize_anomalies(df)

    # Clustering
    df, kmeans = employee_clustering(X_scaled, df)

    # SHAP explainability
    shap_explain(clf, X_scaled, features)

    # Survival analysis
    survival_analysis(df)

    # Forecasting
    ts = build_time_series(df)
    prophet = train_forecast_model(ts)
    forecast, summary = forecast_growth(prophet, ts)
    plot_forecast_simple(ts, forecast)

    # Save everything
    save_artifacts(
        r"C:\Users\finnd\OneDrive\Documents\FYP\models",
        {
            "attrition_model": clf,
            "anomaly_model": anom,
            "kmeans_model": kmeans,
            "encoders": encoders,
            "scaler": scaler,
            "prophet_model": prophet,
            "feature_names": features
        }
    )


if __name__ == "__main__":
    main()
