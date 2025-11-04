import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import joblib
import os
import matplotlib.pyplot as plt

# ------------------------------
# Load Employee CSV
# ------------------------------
def load_data():
    csv_path = r"C:\Users\finnd\OneDrive\Documents\FYP\Oracle\Employee.csv"  # update if needed
    data = pd.read_csv(csv_path)
    print("✅ Dataset loaded successfully.")
    print(data.head())
    return data

# ------------------------------
# Preprocess the data
# ------------------------------
def preprocess_data(df):
    # Encode categorical columns
    categorical_cols = ["Education", "City", "Gender", "EverBenched"]
    label_encoders = {}

    for col in categorical_cols:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col])
        label_encoders[col] = le

    # Separate features and target
    X = df.drop("LeaveOrNot", axis=1)
    y = df["LeaveOrNot"]

    # Scale numerical features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    return X_scaled, y, label_encoders, scaler

# ------------------------------
# Train classification model
# ------------------------------
def train_model(X, y):
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X, y)
    return model

# ------------------------------
# Evaluate and visualize results
# ------------------------------
def evaluate_model(model, X_test, y_test):
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print(f"\n✅ Model Accuracy: {acc * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred))

# ------------------------------
# Save model and encoders
# ------------------------------
def save_artifacts(model, encoders, scaler):
    output_dir = r"C:\Users\finnd\OneDrive\Documents\FYP\models"
    os.makedirs(output_dir, exist_ok=True)

    joblib.dump(model, os.path.join(output_dir, "employee_model.pkl"))
    joblib.dump(encoders, os.path.join(output_dir, "label_encoders.pkl"))
    joblib.dump(scaler, os.path.join(output_dir, "scaler.pkl"))

    print(f"\n💾 Model and preprocessing objects saved in: {output_dir}")

# ------------------------------
# Visualize a feature relationship
# ------------------------------
def visualize(df):
    plt.figure(figsize=(10, 6))
    plt.scatter(df["Age"], df["ExperienceInCurrentDomain"], c=df["LeaveOrNot"], cmap="coolwarm", alpha=0.7)
    plt.xlabel("Age")
    plt.ylabel("ExperienceInCurrentDomain")
    plt.title("Employee Retention Visualization (color = LeaveOrNot)")
    plt.show()

# ------------------------------
# Main execution
# ------------------------------
def main():
    df = load_data()
    X_scaled, y, encoders, scaler = preprocess_data(df)

    # Train-test split
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)

    model = train_model(X_train, y_train)
    evaluate_model(model, X_test, y_test)
    save_artifacts(model, encoders, scaler)
    visualize(df)

if __name__ == "__main__":
    main()
