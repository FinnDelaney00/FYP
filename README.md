# SmartStream Prototype – Lambda & ML Scripts

This README describes how the two main Python files in the prototype fit together:

- `MLModelLambda.py` – offline ML pipeline used to train and evaluate models on the employee dataset. :contentReference[oaicite:0]{index=0}  
- `LambdaCode.py` – AWS Lambda function that transforms raw change-data-capture (CDC) events from S3 into a clean “trusted” layer. :contentReference[oaicite:1]{index=1}  

It also explains why the ML file had to be simplified due to Lambda time limits, why the Lambda code is designed to run **inside** AWS Lambda and not as a local script, and how most of the prototype wiring was done through the AWS Console.

---

## 1. High-Level Flow

The prototype SmartStream pipeline is split into two main parts:

1. **Streaming / ETL path (online, serverless)**  
   - Source database → AWS DMS / Firehose → **S3 raw zone**  
   - S3 ObjectCreated event → **`LambdaCode.py` Lambda**  
   - Lambda parses and normalises records → **S3 trusted zone (partitioned by ingest_date)** :contentReference[oaicite:2]{index=2}  

2. **Analytics / ML path (offline, batch)**  
   - Trusted data exported / mirrored to a local CSV (or equivalent dataset)  
   - **`MLModelLambda.py`** is run locally to: preprocess, train a RandomForest, run anomaly detection, and perform a simple headcount forecast with Prophet. :contentReference[oaicite:3]{index=3}  

For the **prototype**, these two parts are not fully automated end-to-end. The streaming side runs continuously in AWS Lambda and S3, while the ML side is executed manually on a local machine against a static snapshot of the data.

---

## 2. `MLModelLambda.py` – Offline ML Pipeline

`MLModelLambda.py` implements a compact ML pipeline around the employee dataset. Its responsibilities are: :contentReference[oaicite:4]{index=4}  

- **Preprocessing**
  - Encodes categorical columns (`Education`, `City`, `Gender`, `EverBenched`, `PaymentTier`) using `LabelEncoder`.
  - Standardises all features with `StandardScaler`.
- **Classification**
  - Trains a `RandomForestClassifier` to predict `LeaveOrNot` (attrition).
  - Evaluates with accuracy and a classification report.
- **Anomaly detection**
  - Trains an `IsolationForest` on the scaled features.
  - Labels each employee as normal (`1`) or anomalous (`-1`) and computes anomaly scores.
- **Forecasting**
  - Builds a headcount time series from `JoiningYear` and uses `Prophet` to forecast the next 6 months of headcount.
- **Visualisation**
  - Produces a simple 3-panel dashboard:
    1. Stay vs leave counts,
    2. Feature importance,
    3. Historical vs forecasted headcount.

The script is intended to be run **locally** (e.g. from a terminal or IDE), not inside Lambda:

```bash
python MLModelLambda.py
