"""
MLModelLambda.py

Prototype ML pipeline for SmartStream:
- Preprocessing (encoding + scaling)
- Attrition classification (RandomForest)
- Anomaly detection (IsolationForest)
- Simple headcount forecasting (Prophet)
- Compact visualisation of key insights
"""

import os
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.metrics import accuracy_score, classification_report

try:
    from prophet import Prophet
except ImportError:
    try:
        from fbprophet import Prophet
    except ImportError:
        Prophet = None


# ==========================================
# 1. LOAD DATA
# ==========================================
def load_data(csv_path=r"C:\Users\finnd\OneDrive\Documents\FYP\FYP\Employee.csv"):
    """
    Load the employee dataset from a CSV file.
    """
    # Read the CSV file from disk into a pandas DataFrame
    df = pd.read_csv(csv_path)
    # Print a log message with the number of rows and columns loaded
    print(f"[LOAD] Dataset loaded: {df.shape[0]} rows, {df.shape[1]} columns")
    # Return the loaded DataFrame to the caller
    return df


# ==========================================
# 2. PREPROCESSING
# ==========================================
def preprocess_for_ml(df):
    """
    Prepare the dataframe for ML models. Turns categorical columns into numeric columns
    using Label Encoding, and standardises numeric features using StandardScaler.

    """
    # Create a copy of the input DataFrame to avoid mutating the original
    df = df.copy()

    # Define the list of categorical columns that should be label-encoded
    categorical_cols = ["Education", "City", "Gender", "EverBenched", "PaymentTier"]
    encoders = {}

    # Iterate over each categorical column name
    for col in categorical_cols:
        # Create a new LabelEncoder instance
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col])
        encoders[col] = le

    # Separate features X by dropping the target column 'LeaveOrNot'
    X = df.drop("LeaveOrNot", axis=1)
    # Extract the target y as the 'LeaveOrNot' column
    y = df["LeaveOrNot"]

    # Create a StandardScaler instance to standardise numeric features
    scaler = StandardScaler()
    # Fit the scaler on all features and transform them into a scaled NumPy array
    X_scaled = scaler.fit_transform(X)

    # Log to indicate that preprocessing is complete
    print("[PREPROCESS] Features encoded and scaled.")
    # Return the scaled features, target vector, encoders, scaler,
    # feature names, and the encoded DataFrame
    return X_scaled, y, encoders, scaler, X.columns.tolist(), df


# ==========================================
# 3. ATTRITION CLASSIFICATION
# ==========================================
def train_attrition_model(X_train, y_train):
    """
    Train a Random Forest classifier to predict attrition(LeaveOrNot).
    """
    # Create a RandomForestClassifier with 200 trees,
    # fixed random_state for reproducibility, and n_jobs=-1 to use all cores
    model = RandomForestClassifier(
        n_estimators=200,
        random_state=42,
        n_jobs=-1
    )
    # Fit the classifier on the training data
    model.fit(X_train, y_train)
    print("[CLASSIFIER] RandomForest trained.")
    return model


def evaluate_attrition_model(model, X_test, y_test):
    """
    Evaluate classifier with accuracy + classification report.
    """
    # Use the trained model to predict labels for the test features
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)

    print("\n=== ATTRITION CLASSIFICATION ===")
    print(f"Accuracy: {acc * 100:.2f}%")
    # Print a detailed classification report (precision, recall, f1-score, support)
    print("\nClassification report:")
    print(classification_report(y_test, preds))
    return acc


# ==========================================
# 4. ANOMALY DETECTION
# ==========================================
def train_anomaly_detector(X_scaled):
    """
    Train an Isolation Forest to flag anomalous employees.
    """
    # Create an IsolationForest model to detect outliers in the feature space
    model = IsolationForest(
        n_estimators=200,   # number of trees used internally
        contamination=0.01,  # expected proportion of anomalies (2%)
        random_state=42     # random seed for reproducibility
    )
    # Fit the anomaly detector on the scaled feature matrix
    model.fit(X_scaled)
    # Log that the anomaly model has been trained
    print("[ANOMALY] IsolationForest trained.")
    return model


def label_anomalies(df, X_scaled, anomaly_model):
    """
    Label each record as normal or anomalous.
    """
    df = df.copy()
    # Use the anomaly_model to predict anomaly labels:
    #   1  = normal point
    #  -1  = anomaly / outlier
    df["anomaly_label"] = anomaly_model.predict(X_scaled)
    # Use decision_function to get anomaly scores:
    # lower scores indicate more anomalous points
    df["anomaly_score"] = anomaly_model.decision_function(X_scaled)

    n_anom = (df["anomaly_label"] == -1).sum()
    # Log the number of anomalies detected
    print(f"[ANOMALY] Total anomalies detected: {n_anom}")
    # Return the augmented dataframe and the anomaly count
    return df, n_anom


# ==========================================
# 5. SIMPLE FORECASTING (HEADCOUNT)
# ==========================================
def build_headcount_time_series(df):
    """
    Build a monthly headcount time series from 'JoiningYear'.
    """
    # Ensure the dataset contains the JoiningYear column required for the time series
    if "JoiningYear" not in df.columns:
        raise ValueError("Dataframe must contain 'JoiningYear' for forecasting.")

    # Group the data by JoiningYear and count how many employees joined each year
    yearly = (
        df.groupby("JoiningYear")
        .size()
        .reset_index(name="hires")
        .sort_values("JoiningYear")
    )
    # Compute cumulative sum of yearly hires to approximate total headcount per year
    yearly["headcount"] = yearly["hires"].cumsum()
    # Create a datetime column 'ds' representing the first day of each JoiningYear
    yearly["ds"] = pd.to_datetime(yearly["JoiningYear"].astype(str) + "-01-01")

    # Select 'ds' and 'headcount', set 'ds' as the index, and resample monthly
    ts = (
        yearly[["ds", "headcount"]]
        .set_index("ds")
        .resample("MS")           # 'MS' = month start frequency
        .interpolate("linear")    #  headcount between yearly points
        .reset_index()
        .rename(columns={"headcount": "y"})  # Rename to 'y' for Prophet
    )

    # Log that the headcount time series is ready
    print("[FORECAST] Headcount time series built.")
    return ts


def train_forecast_model(ts):
    """
    Train a Prophet model on the headcount time series.
    """
    # If Prophet is not available, raise a runtime error with instructions
    if Prophet is None:
        raise RuntimeError(
            "Prophet is not installed. Install 'prophet' or 'fbprophet' to enable forecasting."
        )

    # Create a Prophet model with yearly seasonality enabled
    model = Prophet(yearly_seasonality=True)
    # Fit the Prophet model on the provided time series
    model.fit(ts)
    print("[FORECAST] Prophet model trained.")
    # Return the trained Prophet model
    return model


def forecast_headcount(model, periods=6):
    """
    Forecast future headcount for a number of months.
    """
    # Create a DataFrame of future dates extending the series by 'periods' months
    future = model.make_future_dataframe(periods=periods, freq="MS")
    # Use the Prophet model to predict headcount for historical + future dates
    forecast = model.predict(future)
    # Extract only the final 'periods' rows for a compact forecast summary
    summary = forecast.tail(periods)[["ds", "yhat", "yhat_lower", "yhat_upper"]]

    # Print a header for forecast summary output
    print("\n=== HEADCOUNT FORECAST (NEXT MONTHS) ===")
    print(summary)
    return forecast, summary


# ==========================================
# 6. SIMPLE VISUALISATIONS
# ==========================================
def plot_prototype_insights(df, feature_names, clf, acc, ts, forecast, n_anom):
    """
    Compact 3-panel plot for the prototype:
    (1) Attrition counts.
    (2) Feature importance.
    (3) Historical vs forecast headcount.
    """
    # Extract feature importances from the trained RandomForest model
    importances = clf.feature_importances_
    # Get indices that would sort importances in ascending order
    sorted_idx = np.argsort(importances)
    # Apply sorted indices to feature names to align with sorted importances
    sorted_features = np.array(feature_names)[sorted_idx]
    # Sort the importance values using the same index order
    sorted_importances = importances[sorted_idx]

    # Create a figure with three subplots in one row for three panels
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    # Unpack axes into ax1, ax2, ax3 for clarity
    ax1, ax2, ax3 = axes

    # (1) Plot bar chart of employees staying vs leaving
    df["LeaveOrNot"].value_counts().sort_index().plot(kind="bar", ax=ax1)
    ax1.set_title(
        f"Stay vs Leave\nAcc: {acc*100:.1f}% | Anomalies: {n_anom}"
    )
    ax1.set_xlabel("0 = Stay, 1 = Leave")
    ax1.set_ylabel("Count")

    # (2) Plot horizontal bar chart of feature importances
    ax2.barh(sorted_features, sorted_importances)
    ax2.set_title("Feature Importance (RandomForest)")
    ax2.set_xlabel("Importance")

    # (3) Headcount forecast: historical and predicted
    ax3.plot(ts["ds"], ts["y"], label="Historical headcount")
    future_segment = forecast.tail(6)
    ax3.plot(future_segment["ds"], future_segment["yhat"], "--", label="Forecast")
    ax3.fill_between(
        future_segment["ds"],
        future_segment["yhat_lower"],
        future_segment["yhat_upper"],
        alpha=0.2
    )
    ax3.set_title("Headcount Forecast (next 6 months)")
    ax3.set_xlabel("Date")
    ax3.set_ylabel("Headcount")
    ax3.legend()

    # Adjust subplot layouts to prevent overlapping labels
    plt.tight_layout()
    # Render the figure on screen
    plt.show()

# ==========================================
# 7. MAIN ORCHESTRATION
# ==========================================
def main():
    """
    Run the full prototype ML pipeline:

    1. Load and preprocess data.
    2. Train and evaluate RandomForest classifier.
    3. Train IsolationForest and label anomalies.
    4. Build headcount time series and forecast.
    5. Plot a simple 3-panel dashboard.
    6. Save key artefacts (models, encoders, scaler, feature names, forecast model).
    """
    # 1) Load raw employee dataset from CSV
    df_raw = load_data()

    # 2) Preprocess data: encode categoricals, scale features, and keep encoders/scaler
    X_scaled, y, encoders, scaler, features, df_encoded = preprocess_for_ml(df_raw)

    # 3) Split data into training and test sets for classification
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled,        
        y,               
        test_size=0.2,   
        random_state=42,
        stratify=y       
    )
    # Train the RandomForest classifier on the training data
    clf = train_attrition_model(X_train, y_train)
    # Evaluate the classifier on the test data and get accuracy
    acc = evaluate_attrition_model(clf, X_test, y_test)

    # 4) Train anomaly detection model on all scaled data
    anom_model = train_anomaly_detector(X_scaled)
    # Label rows as normal/anomalous and retrieve anomaly count
    df_with_anom, n_anom = label_anomalies(df_encoded, X_scaled, anom_model)

    # 5) Build headcount time series from JoiningYear and train a Prophet model
    ts = build_headcount_time_series(df_with_anom)
    # Train the forecasting model using the headcount time series
    prophet_model = train_forecast_model(ts)
    # Forecast the next 6 months of headcount and get a summary
    forecast, summary = forecast_headcount(prophet_model, periods=6)

    # 6) Create and show the three-panel visual dashboard
    plot_prototype_insights(
        df_with_anom,   # Data with attrition and anomaly labels
        features,       # Feature names used by the classifier
        clf,            # Trained RandomForest model
        acc,            # Accuracy on test set
        ts,             # Historical headcount time series
        forecast,       # Full Prophet forecast
        n_anom          # Number of anomalies detected
    )


if __name__ == "__main__":
    main()
