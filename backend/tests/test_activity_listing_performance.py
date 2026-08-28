from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.app.services.workflow_service import WorkflowService
from backend.tests.test_settings_persistence import admin_user


class ActivityListingPerformanceTests(unittest.TestCase):
    def test_all_activities_are_loaded_in_one_bulk_query(self):
        activities = [
            {"id": "activity-1", "workflow_id": "workflow-1"},
            {"id": "activity-2", "workflow_id": "workflow-2"},
        ]
        service = object.__new__(WorkflowService)
        service.supabase = MagicMock()
        service.supabase.select.return_value = activities
        service._list_accessible_workflow_ids = MagicMock(return_value=["workflow-1", "workflow-2"])
        service._dependency_map = MagicMock(return_value={})
        service._attachment_map = MagicMock(return_value={})
        service._profile_map = MagicMock(return_value={})
        service._serialize_activity = MagicMock(side_effect=lambda activity, **_kwargs: activity)

        result = service.list_all_activities(admin_user())

        self.assertEqual(result, activities)
        self.assertEqual(service.supabase.select.call_count, 2)
        self.assertEqual(
            service.supabase.select.call_args_list[0].kwargs["filters"]["workflow_id"],
            'in.("workflow-1","workflow-2")',
        )


if __name__ == "__main__":
    unittest.main()
