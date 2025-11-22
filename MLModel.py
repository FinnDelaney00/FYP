import os
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.metrics import accuracy_score, classification_report

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
# 2. PREPROCESSING (ALL COLUMNS INCLUDED)
# ==========================================
def preprocess_for_ml(df):
    df = df.copy()

    # CATEGORICAL columns -> label encode
    categorical_cols = ["Education", "City", "Gender", "EverBenched", "PaymentTier"]
    encoders = {}

    for col in categorical_cols:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col])
        encoders[col] = le

    # FEATURES & TARGET
    X = df.drop("LeaveOrNot", axis=1)
    y = df["LeaveOrNot"]

    # STANDARDIZE all numeric columns
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    return X_scaled, y, encoders, scaler, X.columns.tolist()


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
# 4. ANOMALY DETECTION
# ==========================================
def train_anomaly_detector(X_scaled):
    model = IsolationForest(
        n_estimators=200,
        contamination=0.05,
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


# ==========================================
# 5. TIME SERIES CREATION (USING JoiningYear)
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

    print("\n=== TIME SERIES SAMPLE ===")
    print(ts.head())
    print(ts.tail())

    return ts


# ==========================================
# 6. FORECASTING WITH PROPHET
# ==========================================
def train_forecast_model(ts):
    model = Prophet(yearly_seasonality=True)
    model.fit(ts)
    return model


def forecast_growth(model, ts, months=6):
    future = model.make_future_dataframe(periods=months, freq="MS")
    forecast = model.predict(future)
    summary = forecast.tail(months)[["ds", "yhat", "yhat_lower", "yhat_upper"]]

    print(f"\n=== FORECAST: NEXT {months} MONTHS ===")
    print(summary)

    return forecast, summary


# ==========================================
# 7. VISUALIZATIONS (USER-FRIENDLY)
# ==========================================
def visualize_attrition(df):
    plt.figure(figsize=(6,4))
    df["LeaveOrNot"].value_counts().plot(kind="bar", color=["green","red"])
    plt.title("Employees Leaving vs Staying")
    plt.xlabel("0 = Stay, 1 = Leave")
    plt.ylabel("Count")
    plt.tight_layout()
    plt.show()


def visualize_anomalies(df):
    sorted_df = df.sort_values("anomaly_score")

    plt.figure(figsize=(10,5))
    plt.plot(sorted_df["anomaly_score"].values, label="Anomaly Score")
    plt.axhline(0, color="red", linestyle="--", label="Anomaly Threshold")
    plt.title("Anomaly Scores (Lower = More Anomalous)")
    plt.xlabel("Employees (sorted)")
    plt.ylabel("Score")
    plt.legend()
    plt.tight_layout()
    plt.show()


def plot_forecast_simple(ts, forecast, months=6):
    plt.figure(figsize=(10,6))

    plt.plot(ts["ds"], ts["y"], label="Historical Headcount", linewidth=2)

    future = forecast.tail(months)
    plt.plot(future["ds"], future["yhat"], label="Predicted Growth", linestyle="--")

    plt.fill_between(
        future["ds"],
        future["yhat_lower"],
        future["yhat_upper"],
        alpha=0.2,
        label="Prediction Range"
    )

    plt.title("Employee Growth Forecast")
    plt.xlabel("Date")
    plt.ylabel("Headcount")
    plt.legend()
    plt.tight_layout()
    plt.show()


# ==========================================
# 8. SAVE ARTIFACTS
# ==========================================
def save_artifacts(path, attr_model, anom_model, encoders, scaler, features, prophet_model):
    os.makedirs(path, exist_ok=True)

    joblib.dump(attr_model, os.path.join(path, "attrition_model.pkl"))
    joblib.dump(anom_model, os.path.join(path, "anomaly_model.pkl"))
    joblib.dump(encoders, os.path.join(path, "encoders.pkl"))
    joblib.dump(scaler, os.path.join(path, "scaler.pkl"))
    joblib.dump(features, os.path.join(path, "features.pkl"))
    joblib.dump(prophet_model, os.path.join(path, "prophet_model.pkl"))

    print(f"\nSaved all models to: {path}")


# ==========================================
# 9. MAIN EXECUTION
# ==========================================
def main():
    df = load_data()

    X_scaled, y, encoders, scaler, features = preprocess_for_ml(df)

    # Classification
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    attr_model = train_attrition_model(X_train, y_train)
    evaluate_attrition_model(attr_model, X_test, y_test)

    # Anomaly detection
    anom_model = train_anomaly_detector(X_scaled)
    df = label_anomalies(df, X_scaled, anom_model)

    # Forecasting
    ts = build_time_series(df)
    prophet_model = train_forecast_model(ts)
    forecast, summary = forecast_growth(prophet_model, ts, months=6)

    # Visuals
    visualize_attrition(df)
    visualize_anomalies(df)
    plot_forecast_simple(ts, forecast)

    # Save models
    save_artifacts(
        r"C:\Users\finnd\OneDrive\Documents\FYP\models",
        attr_model,
        anom_model,
        encoders,
        scaler,
        features,
        prophet_model
    )


if __name__ == "__main__":
    main()
