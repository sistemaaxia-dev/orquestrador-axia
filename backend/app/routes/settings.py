from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.workflow_service import WorkflowError, WorkflowService


settings_bp = Blueprint("settings", __name__)


@settings_bp.get("/settings/companies")
def list_companies():
    try:
        return jsonify(WorkflowService().list_companies(get_current_user()))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.post("/settings/companies")
def create_company():
    try:
        return jsonify(WorkflowService().create_company(get_current_user(), request.get_json(silent=True) or {})), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.patch("/settings/companies/<company_id>")
def update_company(company_id: str):
    try:
        return jsonify(WorkflowService().update_company(company_id, get_current_user(), request.get_json(silent=True) or {}))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.get("/settings/companies/<company_id>/holidays")
def list_holidays(company_id: str):
    try:
        return jsonify(WorkflowService().list_holidays(company_id, get_current_user()))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.post("/settings/companies/<company_id>/holidays")
def create_holiday(company_id: str):
    try:
        return jsonify(WorkflowService().create_holiday(company_id, get_current_user(), request.get_json(silent=True) or {})), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.get("/settings/holidays")
def list_global_holidays():
    try:
        return jsonify(WorkflowService().list_holidays(None, get_current_user()))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.post("/settings/holidays")
def create_global_holiday():
    try:
        return jsonify(WorkflowService().create_holiday(None, get_current_user(), request.get_json(silent=True) or {})), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.delete("/settings/holidays/<holiday_id>")
def delete_holiday(holiday_id: str):
    try:
        WorkflowService().delete_holiday(holiday_id, get_current_user())
        return jsonify({"message": "Feriado excluido."})
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.patch("/settings/holidays/<holiday_id>")
def update_holiday(holiday_id: str):
    try:
        return jsonify(WorkflowService().update_holiday(holiday_id, get_current_user(), request.get_json(silent=True) or {}))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.get("/settings/stages")
def list_stage_settings():
    try:
        user = get_current_user()
        rows = WorkflowService().list_stage_settings(user)
        return jsonify(rows)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.put("/settings/stages/<stage_name>")
def update_stage_setting(stage_name: str):
    try:
        user = get_current_user()
        updated = WorkflowService().upsert_stage_setting(user, stage_name, request.get_json(silent=True) or {})
        return jsonify(updated)
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.post("/settings/deadline-preview")
def preview_deadline():
    try:
        return jsonify(WorkflowService().preview_deadline(get_current_user(), request.get_json(silent=True) or {}))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except (WorkflowError, ValueError) as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.get("/settings/teams")
def list_teams():
    try:
        return jsonify(WorkflowService().list_teams(get_current_user()))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401


@settings_bp.post("/settings/teams")
def create_team():
    try:
        return jsonify(WorkflowService().create_team(get_current_user(), request.get_json(silent=True) or {})), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.patch("/settings/teams/<team_id>")
def update_team(team_id: str):
    try:
        return jsonify(WorkflowService().update_team(team_id, get_current_user(), request.get_json(silent=True) or {}))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.delete("/settings/teams/<team_id>")
def delete_team(team_id: str):
    try:
        WorkflowService().delete_team(team_id, get_current_user())
        return jsonify({"message": "Equipe excluida."})
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.get("/settings/directorates")
def list_directorates():
    try:
        return jsonify(WorkflowService().list_directorates(get_current_user()))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401


@settings_bp.post("/settings/directorates")
def create_directorate():
    try:
        return jsonify(WorkflowService().create_directorate(get_current_user(), request.get_json(silent=True) or {})), 201
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.patch("/settings/directorates/<directorate_id>")
def update_directorate(directorate_id: str):
    try:
        return jsonify(WorkflowService().update_directorate(directorate_id, get_current_user(), request.get_json(silent=True) or {}))
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400


@settings_bp.delete("/settings/directorates/<directorate_id>")
def delete_directorate(directorate_id: str):
    try:
        WorkflowService().delete_directorate(directorate_id, get_current_user())
        return jsonify({"message": "Diretoria excluida."})
    except AuthError as error:
        return jsonify({"error": str(error)}), 401
    except WorkflowError as error:
        return jsonify({"error": str(error)}), 400
