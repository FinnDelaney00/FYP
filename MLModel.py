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
    """
    Load the employee dataset from a CSV file.

    Parameters
    ----------
    csv_path : str
        Full path to the CSV file containing the employee data.

    Returns
    -------
    df : pandas.DataFrame
        Loaded dataframe with all raw columns as stored in the CSV.
    """
    df = pd.read_csv(csv_path)
    # Basic logging to confirm size and get a quick glimpse of the data
    print(f"Loaded dataset: {df.shape[0]} rows, {df.shape[1]} columns")
    print(df.head())
    return df


# ==========================================
# 2. PREPROCESSING
# ==========================================
def preprocess_for_ml(df):
    """
    Preprocess the raw dataframe so that it can be used by ML models.

    Steps:
    1. Copy the original dataframe to avoid side effects.
    2. Label-encode categorical columns so models can handle them as integers.
    3. Split into features X and target y ('LeaveOrNot').
    4. Standardise all numeric features to zero mean and unit variance.
    """
    df = df.copy()

    # Categorical columns that need to be converted from strings to integer codes
    categorical_cols = ["Education", "City", "Gender", "EverBenched", "PaymentTier"]
    encoders = {}

    for col in categorical_cols:
        # For each categorical column, learn a mapping from category string to integer
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col])
        encoders[col] = le  # Store encoder so we can transform/untransform later

    # Separate features (X) from label (y)
    X = df.drop("LeaveOrNot", axis=1)
    y = df["LeaveOrNot"]

    # Standardise all features so models are not biased by scale differences
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    return X_scaled, y, encoders, scaler, X.columns.tolist(), df


# ==========================================
# 3. ATTRITION CLASSIFICATION
# ==========================================
def train_attrition_model(X_train, y_train):
    """
    Train a Random Forest classifier to predict employee attrition.
    """
    model = RandomForestClassifier(
        n_estimators=200,  # Number of trees in the forest (more trees = more stable predictions)
        random_state=42,   # Seed for reproducibility
        n_jobs=-1          # Use all available CPU cores
    )
    model.fit(X_train, y_train)
    return model


def evaluate_attrition_model(model, X_test, y_test):
    """
    Evaluate the trained classifier on a hold-out test set.
    """
    print("\n=== ATTRITION CLASSIFICATION ===")
    preds = model.predict(X_test)  # Discrete predictions for each employee
    acc = accuracy_score(y_test, preds)
    print(f"Accuracy: {acc * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, preds))
    return acc


# ==========================================
# 4. ANOMALY DETECTION (NO PLOT, JUST COUNT)
# ==========================================
def train_anomaly_detector(X_scaled):
    """
    Train an Isolation Forest model to detect anomalous employees (outliers).

    Isolation Forest works by randomly partitioning the feature space and
    identifying points that are isolated in fewer splits (potential anomalies).
    """
    model = IsolationForest(
        n_estimators=200,     # Number of base estimators (trees)
        contamination=0.02,   # Approximate proportion of anomalies expected in the data
        random_state=42       # For reproducible results
    )
    model.fit(X_scaled)
    return model


def label_anomalies(df, X_scaled, anomaly_model):
    """
    Use the trained Isolation Forest to label each record as normal or anomalous.
    """
    df = df.copy()

    # predict():
    #   1  -> normal point
    #  -1  -> anomaly / outlier
    df["anomaly_label"] = anomaly_model.predict(X_scaled)
    # decision_function():
    #   Higher scores -> more normal
    #   Lower scores  -> more anomalous
    df["anomaly_score"] = anomaly_model.decision_function(X_scaled)

    n_anom = (df["anomaly_label"] == -1).sum()
    print("\n=== ANOMALY SUMMARY ===")
    print("Total anomalies detected:", n_anom)

    return df, n_anom


# ==========================================
# 5. CLUSTERING
# ==========================================
def employee_clustering(X_scaled, df, n_clusters=3):
    """
    Cluster employees into groups using KMeans and compute attrition rate per cluster.
    """
    # n_init="auto" lets sklearn pick a sensible number of KMeans initialisations
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")

    df = df.copy()
    df["cluster"] = kmeans.fit_predict(X_scaled)  # Assign each employee to a cluster

    # Compute mean leave rate per cluster: higher value => more leavers in that cluster
    cluster_attrition = df.groupby("cluster")["LeaveOrNot"].mean()
    print("\n=== CLUSTER ATTRITION RATES ===")
    print(cluster_attrition)

    return df, kmeans, cluster_attrition


# ==========================================
# 6. SURVIVAL ANALYSIS
# ==========================================
def compute_survival(df, current_year=2025):
    """
    Run Kaplan–Meier survival analysis to estimate retention over tenure.

    Tenure is computed as (current_year - JoiningYear), assuming all employees
    start in their joining year and 'LeaveOrNot' marks whether they have left.
    """
    df = df.copy()
    # Approximate tenure in years
    df["tenure_years"] = current_year - df["JoiningYear"]

    # Kaplan–Meier model needs:
    #   durations       = time in study (tenure)
    #   event_observed  = 1 if event (leaving) has occurred, else 0
    km = KaplanMeierFitter()
    km.fit(durations=df["tenure_years"], event_observed=df["LeaveOrNot"])

    # survival_function_ gives a step function of survival probability over time
    survival_df = km.survival_function_.reset_index()  # columns: ['timeline', 'KM_estimate']
    return survival_df


# ==========================================
# 7. TIME SERIES & FORECASTING
# ==========================================
def build_time_series(df):
    """
    Build a monthly headcount time series for Prophet.
    """
    # Count how many employees joined each year
    yearly = (
        df.groupby("JoiningYear")
          .size()
          .reset_index(name="hires")
          .sort_values("JoiningYear")
    )

    # Cumulative sum of hires approximates headcount growth over time
    yearly["headcount"] = yearly["hires"].cumsum()

    # Prophet expects a 'ds' datetime column
    yearly["ds"] = pd.to_datetime(yearly["JoiningYear"].astype(str) + "-01-01")

    # Build monthly series: set index to ds, upsample to monthly (MS = month start),
    # and interpolate to fill gaps between yearly data points
    ts = (
        yearly[["ds", "headcount"]]
        .set_index("ds")
        .resample("MS")            # Monthly frequency
        .interpolate("linear")     # Fill missing months linearly
        .reset_index()
        .rename(columns={"headcount": "y"})  # Prophet expects 'y'
    )
    return ts


def train_forecast_model(ts):
    """
    Train a Prophet model on the headcount time series.
    """
    model = Prophet(yearly_seasonality=True)  # Allow yearly patterns in the data
    model.fit(ts)
    return model


def forecast_growth(model, ts, months=6):
    """
    Use the Prophet model to forecast future headcount.
    """
    # Create a future dataframe extending the timeline by the requested number of months
    future = model.make_future_dataframe(periods=months, freq="MS")

    # Run Prophet predictions
    forecast = model.predict(future)

    # Extract only the final horizon segment for a compact summary
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
    """
    Build a single multi-panel dashboard of all key insights:

    Panels:
    (1) Attrition: counts of staying vs leaving employees.
    (2) Feature importance: Random Forest global importances.
    (3) SHAP values: average absolute impact per feature for class 'Leave'.
    (4) Cluster-wise attrition: mean leave rate by KMeans cluster.
    (5) Kaplan–Meier survival curve: retention probability over tenure.
    (6) Forecast: historical vs predicted headcount with uncertainty bands.
    """
    # ---- Random Forest feature importance ----
    importances = clf.feature_importances_
    # Sort features by importance so bars are ordered from least to most important
    sorted_idx = np.argsort(importances)
    sorted_features = np.array(feature_names)[sorted_idx]
    sorted_importances = importances[sorted_idx]

    # ---- SHAP analysis (global explanation) ----
    # TreeExplainer is optimised for tree-based models like RandomForest
    explainer = shap.TreeExplainer(clf)

    # Use a random subset of up to 1000 samples to keep SHAP computation manageable
    sample_size = min(1000, X_scaled.shape[0])
    X_sample = X_scaled[np.random.choice(X_scaled.shape[0], sample_size, replace=False)]

    # For binary classification, shap_values returns a list [values_for_class_0, values_for_class_1]
    # We focus on class 1 ('Leave') to see what drives attrition
    shap_values = explainer.shap_values(X_sample)[1]

    # Compute average absolute SHAP value per feature as a global importance metric
    shap_mean_abs = np.mean(np.abs(shap_values), axis=0)
    shap_sorted_idx = np.argsort(shap_mean_abs)
    shap_features = np.array(feature_names)[shap_sorted_idx]
    shap_values_sorted = shap_mean_abs[shap_sorted_idx]

    # ---- Create a 3x2 subplot layout for the dashboard ----
    fig, axes = plt.subplots(3, 2, figsize=(12, 14))
    ((ax1, ax2),
     (ax3, ax4),
     (ax5, ax6)) = axes

    # 1) Attrition counts (bar plot of 0 vs 1)
    df["LeaveOrNot"].value_counts().sort_index().plot(kind="bar", ax=ax1)
    ax1.set_title(
        f"Employees Leaving vs Staying\n(Model accuracy: {acc*100:.1f}%, Anomalies: {n_anom})"
    )
    ax1.set_xlabel("0 = Stay, 1 = Leave")
    ax1.set_ylabel("Count")

    # 2) Feature importance from RandomForest
    ax2.barh(sorted_features, sorted_importances)
    ax2.set_title("Feature Importance (RandomForest)")
    ax2.set_xlabel("Importance")

    # 3) SHAP mean |impact| for 'Leave' class
    ax3.barh(shap_features, shap_values_sorted)
    ax3.set_title("Average SHAP Impact on Leaving (class 1)")
    ax3.set_xlabel("Mean |SHAP value|")

    # 4) Cluster-wise attrition rate
    cluster_attrition.plot(kind="bar", ax=ax4)
    ax4.set_title("Cluster-wise Average Attrition")
    ax4.set_xlabel("Cluster")
    ax4.set_ylabel("Avg LeaveOrNot")

    # 5) Kaplan–Meier survival curve: probability of still being employed
    ax5.plot(survival_df["timeline"], survival_df["KM_estimate"])
    ax5.set_title("Employee Retention (Kaplan–Meier)")
    ax5.set_xlabel("Tenure (years)")
    ax5.set_ylabel("Probability of Staying")

    # 6) Headcount forecast: historical vs predicted
    ax6.plot(ts["ds"], ts["y"], label="Historical headcount")

    # Use last 6 rows of forecast as the future horizon for plotting
    future = forecast.tail(6)
    ax6.plot(future["ds"], future["yhat"], linestyle="--", label="Forecast")

    # Add uncertainty interval (yhat_lower, yhat_upper)
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
# 9. MAIN
# ==========================================
def main():
    """
    Orchestrate the full ML pipeline:

    1. Load raw data.
    2. Preprocess (encode + scale).
    3. Train and evaluate attrition classifier.
    4. Train anomaly detector and label anomalies.
    5. Cluster employees and compute attrition per cluster.
    6. Run survival analysis.
    7. Build time series and forecast headcount.
    8. Plot an integrated insights dashboard.
    9. Save all fitted artefacts to disk.
    """
    # 1) Load original dataset
    df_raw = load_data()

    # 2) Preprocess data for ML models
    X_scaled, y, encoders, scaler, features, df_encoded = preprocess_for_ml(df_raw)

    # 3) Train / evaluate classifier with stratified train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled,
        y,
        test_size=0.2,       # 20% of data used for testing
        random_state=42,     # Reproducibility
        stratify=y           # Keep class proportions similar in train and test
    )
    clf = train_attrition_model(X_train, y_train)
    acc = evaluate_attrition_model(clf, X_test, y_test)

    # 4) Anomaly detection (no plotting, only labels and counts)
    anom_model = train_anomaly_detector(X_scaled)
    df_with_anom, n_anom = label_anomalies(df_encoded, X_scaled, anom_model)

    # 5) KMeans clustering + cluster-level attrition stats
    df_clustered, kmeans, cluster_attrition = employee_clustering(X_scaled, df_with_anom)

    # 6) Kaplan–Meier survival analysis for retention over tenure
    survival_df = compute_survival(df_clustered)

    # 7) Time series and Prophet forecasting of headcount
    ts = build_time_series(df_clustered)
    prophet_model = train_forecast_model(ts)
    forecast, summary = forecast_growth(prophet_model, ts, months=6)

    # 8) One-page dashboard combining all major insights
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



if __name__ == "__main__":
    main()
