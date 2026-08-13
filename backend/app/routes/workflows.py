from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.supabase_service import SupabaseService


workflows_bp = Blueprint("workflows", __name__)


@workflows_bp.get("/workflows")
def list_workflows():
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    supabase = SupabaseService()
    rows = supabase.select(
        "workflow_dashboard",
        filters={"participant_email": f"eq.{user.email}"},
        order="created_at.desc",
    )
    return jsonify(rows)


@workflows_bp.post("/workflows")
def create_workflow():
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    payload = request.get_json(silent=True) or {}
    required_fields = ["name", "routine", "period", "start_at", "due_at"]
    missing = [field for field in required_fields if not payload.get(field)]
    if missing:
        return jsonify({"error": f"Campos obrigatorios ausentes: {', '.join(missing)}"}), 400

    supabase = SupabaseService()
    created = supabase.insert(
        "workflows",
        {
            "name": payload["name"],
            "routine": payload["routine"],
            "period": payload["period"],
            "description": payload.get("description", ""),
            "start_at": payload["start_at"],
            "due_at": payload["due_at"],
            "status": "Nao iniciado",
            "created_by": user.id,
        },
    )

    supabase.insert(
        "workflow_participants",
        {
            "workflow_id": created["id"],
            "user_id": user.id,
            "access_level": "owner",
        },
    )

    supabase.insert(
        "activity_history",
        {
            "workflow_id": created["id"],
            "activity_name": "Workflow",
            "action": "Criado",
            "notes": "Workflow criado com sucesso.",
            "performed_by": user.id,
            "performed_by_email": user.email,
            "new_status": "Nao iniciado",
        },
    )

    return jsonify(created), 201


@workflows_bp.get("/workflows/<workflow_id>/activities")
def list_workflow_activities(workflow_id: str):
    try:
        get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    supabase = SupabaseService()
    rows = supabase.select(
        "activities",
        filters={"workflow_id": f"eq.{workflow_id}"},
        order="order_index.asc",
    )
    return jsonify(rows)


@workflows_bp.post("/workflows/<workflow_id>/activities")
def create_workflow_activity(workflow_id: str):
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    payload = request.get_json(silent=True) or {}
    required_fields = ["company_name", "name", "stage", "activity_type", "due_at", "responsible_user_email"]
    missing = [field for field in required_fields if not payload.get(field)]
    if missing:
        return jsonify({"error": f"Campos obrigatorios ausentes: {', '.join(missing)}"}), 400

    supabase = SupabaseService()
    current_rows = supabase.select(
        "activities",
        select="id,order_index,status",
        filters={"workflow_id": f"eq.{workflow_id}"},
        order="order_index.asc",
    )
    next_order = len(current_rows) + 1
    first_activity = next_order == 1

    created = supabase.insert(
        "activities",
        {
            "workflow_id": workflow_id,
            "company_name": payload["company_name"],
            "name": payload["name"],
            "stage": payload["stage"],
            "activity_type": payload["activity_type"],
            "order_index": next_order,
            "due_at": payload["due_at"],
            "responsible_user_email": payload["responsible_user_email"],
            "reviewer_user_email": payload.get("reviewer_user_email"),
            "approver_user_email": payload.get("approver_user_email"),
            "requires_approval": bool(payload.get("requires_approval", False)),
            "requires_attachment": bool(payload.get("requires_attachment", False)),
            "status": "Liberada" if first_activity else "Bloqueada",
            "created_by": user.id,
        },
    )

    supabase.insert(
        "activity_history",
        {
            "workflow_id": workflow_id,
            "activity_id": created["id"],
            "activity_name": created["name"],
            "action": "Cadastro",
            "notes": "Atividade cadastrada no workflow.",
            "performed_by": user.id,
            "performed_by_email": user.email,
            "new_status": created["status"],
        },
    )

    return jsonify(created), 201
