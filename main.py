"""Flask application for managing IT company employee details."""

from __future__ import annotations

import csv
import io
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from flask import Flask, Response, jsonify, render_template, request, url_for
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, ServerSelectionTimeoutError


def _resolve_database_name(uri: str, fallback: str) -> str:
    """Derive the MongoDB database name from a URI, falling back as needed."""
    parsed = urlparse(uri)
    if parsed.path and parsed.path != "/":
        return parsed.path.lstrip("/")
    return fallback


def create_app() -> Flask:
    """Application factory to allow easier testing and configuration."""

    app = Flask(__name__, template_folder="templates", static_folder="static")

    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/it_company")
    db_name = os.getenv("MONGO_DB_NAME") or _resolve_database_name(mongo_uri, "it_company")

    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    db = client[db_name]

    # Ensure we do not store duplicate employees by email address.
    db.employees.create_index("email", unique=True)

    def serialize_employee(document: Dict[str, Any]) -> Dict[str, Any]:
        """Convert a MongoDB document into a JSON-friendly dictionary."""

        created_at = document.get("created_at")
        return {
            "id": str(document.get("_id")),
            "full_name": document.get("full_name", ""),
            "email": document.get("email", ""),
            "department": document.get("department", ""),
            "designation": document.get("designation", ""),
            "experience_years": document.get("experience_years"),
            "salary": document.get("salary"),
            "created_at": created_at.isoformat() if created_at else None,
        }

    def fetch_department_metrics() -> List[Dict[str, Any]]:
        """Aggregate department-level metrics for reporting and charts."""

        pipeline = [
            {"$match": {"department": {"$nin": [None, ""]}}},
            {
                "$group": {
                    "_id": "$department",
                    "headcount": {"$sum": 1},
                    "avg_salary": {"$avg": "$salary"},
                    "avg_experience": {"$avg": "$experience_years"},
                }
            },
            {"$sort": {"headcount": -1, "_id": 1}},
        ]

        metrics: List[Dict[str, Any]] = []
        for document in db.employees.aggregate(pipeline):
            metrics.append(
                {
                    "department": document.get("_id") or "Unknown",
                    "headcount": int(document.get("headcount", 0)),
                    "avg_salary": document.get("avg_salary"),
                    "avg_experience": document.get("avg_experience"),
                }
            )

        return metrics

    def fetch_summary(include_recent: bool = True, recent_limit: int = 4) -> Dict[str, Any]:
        """Compute aggregate statistics used across dashboards and reports."""

        total_employees = db.employees.count_documents({})
        departments = sorted(filter(None, db.employees.distinct("department")))

        salary_document = next(
            db.employees.aggregate(
                [
                    {"$match": {"salary": {"$ne": None}}},
                    {"$group": {"_id": None, "avg_salary": {"$avg": "$salary"}}},
                ]
            ),
            None,
        )
        experience_document = next(
            db.employees.aggregate(
                [
                    {"$match": {"experience_years": {"$ne": None}}},
                    {
                        "$group": {
                            "_id": None,
                            "avg_experience": {"$avg": "$experience_years"},
                        }
                    },
                ]
            ),
            None,
        )

        department_metrics = fetch_department_metrics()
        top_department = department_metrics[0] if department_metrics else None

        recent_hires: List[Dict[str, Any]] = []
        if include_recent:
            recent_hires = [
                serialize_employee(document)
                for document in db.employees.find().sort("created_at", -1).limit(recent_limit)
            ]

        return {
            "total_employees": int(total_employees),
            "average_salary": salary_document.get("avg_salary") if salary_document else None,
            "average_experience": experience_document.get("avg_experience")
            if experience_document
            else None,
            "departments": departments,
            "recent_hires": recent_hires,
            "top_department": top_department,
        }

    @app.route("/")
    def home() -> str:
        """Render the landing dashboard with recent activity and key metrics."""

        summary_error: Optional[str] = None
        try:
            summary = fetch_summary(include_recent=True, recent_limit=5)
        except ServerSelectionTimeoutError:
            summary_error = (
                "Cannot connect to MongoDB. Ensure the database is running and accessible."
            )
            summary = {
                "total_employees": 0,
                "average_salary": None,
                "average_experience": None,
                "departments": [],
                "recent_hires": [],
                "top_department": None,
            }

        return render_template(
            "index.html",
            title="Brightcode IT — Team Intelligence",
            hero_title="Brightcode Workforce",
            hero_subtitle="A single source for people analytics, onboarding, and growth.",
            active_page="dashboard",
            summary=summary,
            summary_error=summary_error,
        )

    @app.route("/add")
    def add_employee_page() -> str:
        """Render the add employee form page."""

        return render_template(
            "add_employee.html",
            title="Add Employee — Brightcode IT",
            hero_title="Brightcode IT",
            hero_subtitle="Track and grow your team with live employee insights.",
            active_page="add",
        )

    @app.route("/roster")
    def roster_page() -> str:
        """Render the employee roster listing page with summaries and reports."""

        summary_error: Optional[str] = None
        try:
            summary = fetch_summary(include_recent=False)
            department_metrics = fetch_department_metrics()
        except ServerSelectionTimeoutError:
            summary = {
                "total_employees": 0,
                "average_salary": None,
                "average_experience": None,
                "departments": [],
                "recent_hires": [],
                "top_department": None,
            }
            department_metrics = []
            summary_error = (
                "Cannot connect to MongoDB. Ensure the database is running and accessible."
            )

        return render_template(
            "roster.html",
            title="Team Roster — Brightcode IT",
            hero_title="Team Roster",
            hero_subtitle="Browse employee profiles, insights, and department trends.",
            active_page="roster",
            summary=summary,
            department_metrics=department_metrics,
            summary_error=summary_error,
        )

    @app.route("/api/employees", methods=["GET"])
    def list_employees():
        """Return all stored employees sorted by recency."""

        try:
            employees = [
                serialize_employee(document)
                for document in db.employees.find().sort("created_at", -1)
            ]
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        return jsonify({"employees": employees})

    @app.route("/api/employees/summary", methods=["GET"])
    def employee_summary():
        """Expose aggregated employee summary metrics for dynamic dashboards."""

        try:
            summary = fetch_summary(include_recent=True)
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        return jsonify(summary)

    @app.route("/api/employees/department-metrics", methods=["GET"])
    def employee_department_metrics():
        """Expose department aggregations for visualisations."""

        try:
            metrics = fetch_department_metrics()
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        return jsonify({"departments": metrics})

    @app.route("/api/employees/export", methods=["GET"])
    def export_employees():
        """Export employee records as a CSV attachment."""

        try:
            cursor = db.employees.find().sort("created_at", -1)
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "Full name",
                "Email",
                "Department",
                "Designation",
                "Experience (years)",
                "Salary",
                "Created at",
            ]
        )

        for document in cursor:
            created_at: Optional[datetime] = document.get("created_at")
            writer.writerow(
                [
                    document.get("full_name", ""),
                    document.get("email", ""),
                    document.get("department", ""),
                    document.get("designation", ""),
                    document.get("experience_years", ""),
                    document.get("salary", ""),
                    created_at.isoformat() if isinstance(created_at, datetime) else "",
                ]
            )

        buffer.seek(0)
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        filename = f"brightcode_employees_{timestamp}.csv"

        return Response(
            buffer.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    def _get_object_id(employee_id: str):
        try:
            return ObjectId(employee_id)
        except (InvalidId, TypeError):
            return None

    @app.route("/api/employees", methods=["POST"])
    def create_employee():
        """Persist a new employee document in MongoDB after validation."""

        payload = request.get_json(silent=True) or {}

        required_fields = ["full_name", "email", "department", "designation"]
        missing_fields = [field for field in required_fields if not payload.get(field)]
        if missing_fields:
            return (
                jsonify(
                    {
                        "error": "Missing required fields: " + ", ".join(missing_fields),
                    }
                ),
                400,
            )

        try:
            experience_years = (
                float(payload["experience_years"])
                if payload.get("experience_years") not in (None, "")
                else None
            )
        except (TypeError, ValueError):
            return jsonify({"error": "Experience (years) must be a numeric value."}), 400

        try:
            salary = (
                float(payload["salary"]) if payload.get("salary") not in (None, "") else None
            )
        except (TypeError, ValueError):
            return jsonify({"error": "Salary must be a numeric value."}), 400

        employee_doc = {
            "full_name": payload["full_name"].strip(),
            "email": payload["email"].strip().lower(),
            "department": payload["department"].strip(),
            "designation": payload["designation"].strip(),
            "experience_years": experience_years,
            "salary": salary,
            "created_at": datetime.utcnow(),
        }

        try:
            insert_result = db.employees.insert_one(employee_doc)
            employee_doc["_id"] = insert_result.inserted_id
        except DuplicateKeyError:
            return (
                jsonify({"error": "An employee with this email already exists."}),
                409,
            )
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        return jsonify({"employee": serialize_employee(employee_doc)}), 201

    @app.route("/api/employees/<employee_id>", methods=["GET"])
    def get_employee(employee_id: str):
        """Return a single employee document."""

        object_id = _get_object_id(employee_id)
        if object_id is None:
            return jsonify({"error": "Invalid employee id."}), 400

        document = db.employees.find_one({"_id": object_id})
        if not document:
            return jsonify({"error": "Employee not found."}), 404

        return jsonify({"employee": serialize_employee(document)})

    @app.route("/api/employees/<employee_id>", methods=["PUT"])
    def update_employee(employee_id: str):
        """Update an existing employee document."""

        object_id = _get_object_id(employee_id)
        if object_id is None:
            return jsonify({"error": "Invalid employee id."}), 400

        existing = db.employees.find_one({"_id": object_id})
        if not existing:
            return jsonify({"error": "Employee not found."}), 404

        payload = request.get_json(silent=True) or {}

        required_fields = ["full_name", "email", "department", "designation"]
        missing_fields = [field for field in required_fields if not payload.get(field)]
        if missing_fields:
            return (
                jsonify(
                    {
                        "error": "Missing required fields: " + ", ".join(missing_fields),
                    }
                ),
                400,
            )

        try:
            experience_years = (
                float(payload["experience_years"])
                if payload.get("experience_years") not in (None, "")
                else None
            )
        except (TypeError, ValueError):
            return jsonify({"error": "Experience (years) must be a numeric value."}), 400

        try:
            salary = (
                float(payload["salary"]) if payload.get("salary") not in (None, "") else None
            )
        except (TypeError, ValueError):
            return jsonify({"error": "Salary must be a numeric value."}), 400

        update_data = {
            "full_name": payload["full_name"].strip(),
            "email": payload["email"].strip().lower(),
            "department": payload["department"].strip(),
            "designation": payload["designation"].strip(),
            "experience_years": experience_years,
            "salary": salary,
        }

        try:
            db.employees.update_one({"_id": object_id}, {"$set": update_data})
        except DuplicateKeyError:
            return (
                jsonify({"error": "An employee with this email already exists."}),
                409,
            )
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        updated = db.employees.find_one({"_id": object_id})
        return jsonify({"employee": serialize_employee(updated)})

    @app.route("/api/employees/<employee_id>", methods=["DELETE"])
    def delete_employee(employee_id: str):
        """Delete an employee document."""

        object_id = _get_object_id(employee_id)
        if object_id is None:
            return jsonify({"error": "Invalid employee id."}), 400

        try:
            result = db.employees.delete_one({"_id": object_id})
        except ServerSelectionTimeoutError:
            return (
                jsonify(
                    {
                        "error": "Cannot connect to MongoDB. Ensure the database is running and accessible.",
                    }
                ),
                503,
            )

        if result.deleted_count == 0:
            return jsonify({"error": "Employee not found."}), 404

        return jsonify({"status": "deleted"}), 200

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
