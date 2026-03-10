import os, io, csv
from dotenv import load_dotenv
from datetime import date
from tempfile import mkdtemp

from flask import Flask, jsonify, render_template, request
from flask_caching import Cache
from pylti1p3.contrib.flask import FlaskOIDCLogin, FlaskMessageLaunch
from pylti1p3.contrib.flask.request import FlaskRequest
from pylti1p3.contrib.flask import FlaskCacheDataStorage
from pylti1p3.tool_config import ToolConfJsonFile
import mysql.connector

from werkzeug.middleware.proxy_fix import ProxyFix

load_dotenv()

SECRET_KEY = os.getenv("FLASK_SECRET_KEY")
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT")),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
}


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_prefix=1)
app.config["APPLICATION_ROOT"] = "/surveyui"
app.secret_key = SECRET_KEY

app.config.from_mapping(
    DEBUG=True,
    CACHE_TYPE="simple",
    CACHE_DEFAULT_TIMEOUT=600,
    SECRET_KEY=SECRET_KEY,
    SESSION_TYPE="filesystem",
    SESSION_FILE_DIR=mkdtemp(),
    SESSION_COOKIE_NAME="surveyui-sessionid",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="None",
)

cache = Cache(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
tool_conf = ToolConfJsonFile(os.path.join(BASE_DIR, "tool_config.json"))


def get_launch_data_storage():
    return FlaskCacheDataStorage(cache)

def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


def compute_status(start_date, end_date):
    today = date.today()
    if start_date and end_date:
        if start_date <= today <= end_date:
            return "Active"
        if end_date < today:
            return "Expired"
        if start_date > today:
            return "Upcoming"
    elif start_date:
        if start_date > today:
            return "Upcoming"
        return "Active"
    elif end_date:
        if end_date < today:
            return "Expired"
        return "Active"
    return "Unknown"


def serialize_survey(row):
    start_date = row[3]
    end_date = row[4]
    return {
        "surveyId": row[0],
        "name": row[1],
        "description": row[2] or "",
        "startDate": start_date.isoformat() if start_date else "",
        "endDate": end_date.isoformat() if end_date else "",
        "status": compute_status(start_date, end_date),
    }



@app.route("/")
def index():
    return "Flask app is running."


@app.route("/login/", methods=["GET", "POST"])
def login():
    flask_request = FlaskRequest()
    target_link_uri = flask_request.get_param("target_link_uri")
    if not target_link_uri:
        raise Exception('Missing "target_link_uri" param')

    oidc_login = FlaskOIDCLogin(
        flask_request,
        tool_conf,
        launch_data_storage=get_launch_data_storage(),
    )
    return oidc_login.enable_check_cookies().redirect(target_link_uri)


@app.route("/launch/", methods=["POST"])
def launch():
    flask_request = FlaskRequest()

    message_launch = FlaskMessageLaunch(
        flask_request,
        tool_conf,
        launch_data_storage=get_launch_data_storage(),
    )
    message_launch.get_launch_data()
    return render_template("surveys.html")


@app.route("/jwks/", methods=["GET"])
def jwks():
    return tool_conf.get_jwks()

@app.route("/api/surveys", methods=["GET"])
def get_surveys():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT surveyId, name, description, startDate, endDate
            FROM surveys
            ORDER BY startDate ASC, surveyId ASC
            """
        )
        rows = cursor.fetchall()
        return jsonify({"data": [serialize_survey(row) for row in rows]})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route("/api/surveys", methods=["POST"])
def create_survey():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    description = payload.get("description") or ""
    start_date = payload.get("startDate") or None
    end_date = payload.get("endDate") or None

    if not name:
        return jsonify({"error": "Name is required."}), 400

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO surveys (name, description, startDate, endDate)
            VALUES (%s, %s, %s, %s)
            """,
            (name, description, start_date, end_date),
        )
        conn.commit()
        return jsonify({"message": "Survey created successfully."}), 201
    except Exception as exc:
        if conn:
            conn.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route("/api/surveys/<int:survey_id>", methods=["PUT"])
def update_survey(survey_id):
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    description = payload.get("description") or ""
    start_date = payload.get("startDate") or None
    end_date = payload.get("endDate") or None

    if not name:
        return jsonify({"error": "Name is required."}), 400

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE surveys
            SET name = %s,
                description = %s,
                startDate = %s,
                endDate = %s
            WHERE surveyId = %s
            """,
            (name, description, start_date, end_date, survey_id),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return jsonify({"error": "Survey not found."}), 404
        return jsonify({"message": "Survey updated successfully."})
    except Exception as exc:
        if conn:
            conn.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@app.route("/api/surveys/<int:survey_id>/assignments/upload", methods=["POST"])
def upload_assignments(survey_id):
    if "file" not in request.files:
        return jsonify({"error": "CSV file is required."}), 400

    file = request.files["file"]
    if not file or not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Please upload a valid CSV file."}), 400

    try:
        content = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify({"error": "CSV must be UTF-8 encoded."}), 400

    reader = csv.DictReader(io.StringIO(content))
    required_columns = {"studentId", "surveyLink"}
    if not reader.fieldnames:
        return jsonify({"error": "CSV file is empty or missing headers."}), 400

    fieldnames = {field.strip() for field in reader.fieldnames if field}
    missing = required_columns - fieldnames
    if missing:
        return jsonify({"error": f"Missing required CSV columns: {', '.join(sorted(missing))}"}), 400

    rows_to_insert = []
    row_number = 1
    for row in reader:
        row_number += 1
        student_id = (row.get("studentId") or "").strip()
        survey_link = (row.get("surveyLink") or "").strip()
        is_sent = (row.get("isSent") or "0").strip() or "0"
        is_completed = (row.get("isCompleted") or "0").strip() or "0"

        if not student_id or not survey_link:
            return jsonify({"error": f"Row {row_number} is missing studentId or surveyLink."}), 400

        rows_to_insert.append(
            (
                student_id,
                survey_id,
                survey_link,
                1 if is_sent in {"1", "true", "TRUE", "yes", "YES"} else 0,
                1 if is_completed in {"1", "true", "TRUE", "yes", "YES"} else 0,
            )
        )

    if not rows_to_insert:
        return jsonify({"error": "CSV file does not contain any data rows."}), 400

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM surveys WHERE surveyId = %s", (survey_id,))
        if cursor.fetchone() is None:
            return jsonify({"error": "Selected survey does not exist."}), 404

        cursor.executemany(
            """
            INSERT INTO survey_assignments (studentId, surveyId, surveyLink, isSent, isCompleted)
            VALUES (%s, %s, %s, %s, %s)
            """,
            rows_to_insert,
        )
        conn.commit()
        return jsonify({"message": f"Uploaded {len(rows_to_insert)} assignment rows successfully."})
    except Exception as exc:
        if conn:
            conn.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()



if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)