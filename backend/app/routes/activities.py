from flask import Blueprint, jsonify, request

from ..services.auth_service import AuthError, get_current_user
from ..services.sharepoint_service import SharePointService
from ..services.supabase_service import SupabaseService


activities_bp = Blueprint("activities", __name__)


@activities_bp.get("/activities/my")
def my_activities():
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    supabase = SupabaseService()
    rows = supabase.select(
        "activities_my_queue",
        filters={"user_email": f"eq.{user.email}"},
        order="due_at.asc",
    )
    return jsonify(rows)


@activities_bp.post("/activities/<activity_id>/decision")
def activity_decision(activity_id: str):
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    payload = request.get_json(silent=True) or {}
    action = payload.get("action")
    if action not in {"Feito", "Nao Feito", "Aprovado", "Reprovado"}:
        return jsonify({"error": "Acao invalida."}), 400

    supabase = SupabaseService()
    activity = supabase.select("activities", filters={"id": f"eq.{activity_id}"})
    if not activity:
        return jsonify({"error": "Atividade nao encontrada."}), 404

    current = activity[0]
    new_status = "Concluida" if action in {"Feito", "Aprovado"} else "Reprovada"
    updated = supabase.update(
        "activities",
        {"id": f"eq.{activity_id}"},
        {
            "result": action,
            "status": new_status,
        },
    )

    supabase.insert(
        "activity_history",
        {
            "workflow_id": current["workflow_id"],
            "activity_id": current["id"],
            "activity_name": current["name"],
            "action": action,
            "notes": payload.get("notes", ""),
            "performed_by": user.id,
            "performed_by_email": user.email,
            "old_status": current["status"],
            "new_status": new_status,
        },
    )

    workflow_activities = supabase.select(
        "activities",
        filters={"workflow_id": f"eq.{current['workflow_id']}"},
        order="order_index.asc",
    )

    if action in {"Feito", "Aprovado"}:
        next_activity = next(
            (
                item
                for item in workflow_activities
                if item["order_index"] > current["order_index"] and item["status"] == "Bloqueada"
            ),
            None,
        )
        if next_activity:
            supabase.update(
                "activities",
                {"id": f"eq.{next_activity['id']}"},
                {"status": "Liberada"},
            )
            supabase.insert(
                "activity_history",
                {
                    "workflow_id": current["workflow_id"],
                    "activity_id": next_activity["id"],
                    "activity_name": next_activity["name"],
                    "action": "Liberada",
                    "notes": "Proxima atividade liberada automaticamente.",
                    "performed_by": user.id,
                    "performed_by_email": user.email,
                    "old_status": "Bloqueada",
                    "new_status": "Liberada",
                },
            )
    else:
        previous_activity = next(
            (
                item
                for item in reversed(workflow_activities)
                if item["order_index"] < current["order_index"]
            ),
            None,
        )
        if previous_activity:
            supabase.update(
                "activities",
                {"id": f"eq.{previous_activity['id']}"},
                {"status": "Liberada"},
            )
            supabase.insert(
                "activity_history",
                {
                    "workflow_id": current["workflow_id"],
                    "activity_id": previous_activity["id"],
                    "activity_name": previous_activity["name"],
                    "action": "Retorno",
                    "notes": "Atividade anterior reaberta por reprovacao/nao feito.",
                    "performed_by": user.id,
                    "performed_by_email": user.email,
                    "old_status": previous_activity["status"],
                    "new_status": "Liberada",
                },
            )

    return jsonify(updated)


@activities_bp.post("/activities/<activity_id>/attachments")
def upload_attachment(activity_id: str):
    try:
        user = get_current_user()
    except AuthError as error:
        return jsonify({"error": str(error)}), 401

    if "file" not in request.files:
        return jsonify({"error": "Arquivo nao informado."}), 400

    supabase = SupabaseService()
    activity_rows = supabase.select("activities", filters={"id": f"eq.{activity_id}"})
    if not activity_rows:
        return jsonify({"error": "Atividade nao encontrada."}), 404

    activity = activity_rows[0]
    workflow_rows = supabase.select("workflows", filters={"id": f"eq.{activity['workflow_id']}"})
    workflow = workflow_rows[0] if workflow_rows else {"name": "workflow"}

    sharepoint = SharePointService()
    upload_result = sharepoint.upload_activity_attachment(
        workflow_name=workflow["name"],
        activity_name=activity["name"],
        file=request.files["file"],
    )

    updated = supabase.update(
        "activities",
        {"id": f"eq.{activity_id}"},
        {
            "sharepoint_file_name": upload_result["file_name"],
            "sharepoint_file_url": upload_result["file_url"],
            "sharepoint_item_id": upload_result["sharepoint_item_id"],
        },
    )

    supabase.insert(
        "activity_history",
        {
            "workflow_id": activity["workflow_id"],
            "activity_id": activity["id"],
            "activity_name": activity["name"],
            "action": "Anexo",
            "notes": f"Arquivo salvo no SharePoint: {upload_result['file_name']}",
            "performed_by": user.id,
            "performed_by_email": user.email,
            "old_status": activity["status"],
            "new_status": activity["status"],
        },
    )

    return jsonify(updated)
