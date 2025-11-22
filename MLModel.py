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
        n_estimators=200,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)
    return model


def evaluate_attrition_model(model, X_test, y_test):
    print("\n=== ATTRITION CLASSIFICATION ===")
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    print(f"Accuracy: {acc * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, preds))
    return acc


# ==========================================
# 4. ANOMALY DETECTION (NO PLOT, JUST COUNT)
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
    df["anomaly_label"] = anomaly_model.predict(X_scaled)     # -1 = anomaly, 1 = normal
    df["anomaly_score"] = anomaly_model.decision_function(X_scaled)

    n_anom = (df["anomaly_label"] == -1).sum()
    print("\n=== ANOMALY SUMMARY ===")
    print("Total anomalies detected:", n_anom)

    return df, n_anom


# ==========================================
# 5. CLUSTERING
# ==========================================
def employee_clustering(X_scaled, df, n_clusters=3):
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
    df = df.copy()
    df["cluster"] = kmeans.fit_predict(X_scaled)

    cluster_attrition = df.groupby("cluster")["LeaveOrNot"].mean()
    print("\n=== CLUSTER ATTRITION RATES ===")
    print(cluster_attrition)

    return df, kmeans, cluster_attrition


# ==========================================
# 6. SURVIVAL ANALYSIS
# ==========================================
def compute_survival(df, current_year=2025):
    df = df.copy()
    df["tenure_years"] = current_year - df["JoiningYear"]

    km = KaplanMeierFitter()
    km.fit(durations=df["tenure_years"], event_observed=df["LeaveOrNot"])

    survival_df = km.survival_function_.reset_index()  # columns: ['timeline', 'KM_estimate']
    return survival_df


# ==========================================
# 7. TIME SERIES & FORECASTING
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
    summary = forecast.tail(months)[["ds", "yhat", "yhat_lower", "yhat_upper"]]
    print("\n=== FORECAST SUMMARY (NEXT MONTHS) ===")
    print(summary)
    return forecast, summary


# ==========================================
# 8. DASHBOARD PLOTTING (ONE PAGE)
# ==========================================
def plot_insights_dashboard(
    df,
    feature_names,
    clf,
    X_scaled,
    cluster_attrition,
    survival_df,
    ts,
    forecast,
    acc,
    n_anom
):
    # Compute feature importance
    importances = clf.feature_importances_
    sorted_idx = np.argsort(importances)
    sorted_features = np.array(feature_names)[sorted_idx]
    sorted_importances = importances[sorted_idx]

    # SHAP: use a sample to keep it fast
    explainer = shap.TreeExplainer(clf)
    sample_size = min(1000, X_scaled.shape[0])
    X_sample = X_scaled[np.random.choice(X_scaled.shape[0], sample_size, replace=False)]
    shap_values = explainer.shap_values(X_sample)[1]   # class 1 (Leave)
    shap_mean_abs = np.mean(np.abs(shap_values), axis=0)
    shap_sorted_idx = np.argsort(shap_mean_abs)
    shap_features = np.array(feature_names)[shap_sorted_idx]
    shap_values_sorted = shap_mean_abs[shap_sorted_idx]

    # Create dashboard
    fig, axes = plt.subplots(3, 2, figsize=(12, 14))
    ((ax1, ax2),
     (ax3, ax4),
     (ax5, ax6)) = axes

    # 1) Attrition counts
    df["LeaveOrNot"].value_counts().sort_index().plot(kind="bar", ax=ax1)
    ax1.set_title(f"Employees Leaving vs Staying\n(Model accuracy: {acc*100:.1f}%, Anomalies: {n_anom})")
    ax1.set_xlabel("0 = Stay, 1 = Leave")
    ax1.set_ylabel("Count")

    # 2) Feature importance
    ax2.barh(sorted_features, sorted_importances)
    ax2.set_title("Feature Importance (RandomForest)")
    ax2.set_xlabel("Importance")

    # 3) SHAP mean |impact|
    ax3.barh(shap_features, shap_values_sorted)
    ax3.set_title("Average SHAP Impact on Leaving (class 1)")
    ax3.set_xlabel("Mean |SHAP value|")

    # 4) Cluster vs attrition
    cluster_attrition.plot(kind="bar", ax=ax4)
    ax4.set_title("Cluster-wise Average Attrition")
    ax4.set_xlabel("Cluster")
    ax4.set_ylabel("Avg LeaveOrNot")

    # 5) Survival curve
    ax5.plot(survival_df["timeline"], survival_df["KM_estimate"])
    ax5.set_title("Employee Retention (Kaplan–Meier)")
    ax5.set_xlabel("Tenure (years)")
    ax5.set_ylabel("Probability of Staying")

    # 6) Forecast (history + future)
    ax6.plot(ts["ds"], ts["y"], label="Historical headcount")
    future = forecast.tail(6)
    ax6.plot(future["ds"], future["yhat"], linestyle="--", label="Forecast")
    ax6.fill_between(
        future["ds"],
        future["yhat_lower"],
        future["yhat_upper"],
        alpha=0.2
    )
    ax6.set_title("Employee Growth Forecast (next 6 months)")
    ax6.set_xlabel("Date")
    ax6.set_ylabel("Headcount")
    ax6.legend()

    plt.tight_layout()
    plt.show()


# ==========================================
# 9. SAVE ARTIFACTS
# ==========================================
def save_artifacts(path, models_dict):
    os.makedirs(path, exist_ok=True)
    for name, obj in models_dict.items():
        joblib.dump(obj, os.path.join(path, f"{name}.pkl"))
    print(f"\nSaved all artifacts to: {path}")


# ==========================================
# 10. MAIN
# ==========================================
def main():
    df_raw = load_data()

    # Preprocess
    X_scaled, y, encoders, scaler, features, df_encoded = preprocess_for_ml(df_raw)

    # Train/evaluate classifier
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    clf = train_attrition_model(X_train, y_train)
    acc = evaluate_attrition_model(clf, X_test, y_test)

    # Anomaly detection (no plot)
    anom_model = train_anomaly_detector(X_scaled)
    df_with_anom, n_anom = label_anomalies(df_encoded, X_scaled, anom_model)

    # Clustering
    df_clustered, kmeans, cluster_attrition = employee_clustering(X_scaled, df_with_anom)

    # Survival
    survival_df = compute_survival(df_clustered)

    # Time series + forecast
    ts = build_time_series(df_clustered)
    prophet_model = train_forecast_model(ts)
    forecast, summary = forecast_growth(prophet_model, ts, months=6)

    # One-page dashboard
    plot_insights_dashboard(
        df_clustered,
        features,
        clf,
        X_scaled,
        cluster_attrition,
        survival_df,
        ts,
        forecast,
        acc,
        n_anom
    )

    # Save models
    save_artifacts(
        r"C:\Users\finnd\OneDrive\Documents\FYP\models",
        {
            "attrition_model": clf,
            "anomaly_model": anom_model,
            "kmeans_model": kmeans,
            "encoders": encoders,
            "scaler": scaler,
            "prophet_model": prophet_model,
            "feature_names": features
        }
    )


if __name__ == "__main__":
    main()
