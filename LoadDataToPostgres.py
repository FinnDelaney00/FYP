import pandas as pd
import psycopg2

# === Update these with your RDS details ===
db_config = {
    "host": "database-1-instance-1.c5s2wqw6wv7h.eu-north-1.rds.amazonaws.com",
    "dbname": "postgres",
    "user": "postgres",
    "password": "Finndel1234{}",
    "port": 5432
}

# Path to your CSV file
csv_file = r"C:\Users\finnd\OneDrive\Documents\FYP\Oracle\Employee.csv"

# Load CSV into a DataFrame
df = pd.read_csv(csv_file)

# Connect to RDS
conn = psycopg2.connect(**db_config)
cur = conn.cursor()

# Insert rows into the table
for _, row in df.iterrows():
    cur.execute("""
        INSERT INTO employee_data (
            Education, JoiningYear, City, PaymentTier, Age, Gender,
            EverBenched, ExperienceInCurrentDomain, LeaveOrNot
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (
        row["Education"],
        int(row["JoiningYear"]),
        row["City"],
        int(row["PaymentTier"]),
        int(row["Age"]),
        row["Gender"],
        row["EverBenched"],
        int(row["ExperienceInCurrentDomain"]),
        int(row["LeaveOrNot"])
    ))

conn.commit()
cur.close()
conn.close()

print("Employee data loaded successfully into RDS!")
