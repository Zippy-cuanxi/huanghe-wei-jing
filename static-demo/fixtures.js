/* 由 build_pages.py 从 samples/ 权威样例自动生成，请勿手改 */
window.__HH_FIXTURES__ = {
  "AUTH-01": {
    "code": "OK",
    "message": "注册成功",
    "data": {
      "account_id": "sample_public_01",
      "account_status": "ACTIVE",
      "default_role": "R1"
    },
    "trace_id": "00000000000000000000000000000014"
  },
  "AUTH-02": {
    "code": "OK",
    "message": "登录成功",
    "data": {
      "session_handle": "sh_6CO6HlF--UZYW9nXef_jyqFeEtJwx_y26t82Eyy8T0A",
      "expires_at": "2026-11-05T00:00:00Z",
      "account_profile": {
        "account_id": "user_r1",
        "account_status": "ACTIVE",
        "roles": [
          "R1"
        ]
      },
      "permission_summary": {
        "roles": [
          "R1"
        ],
        "permissions": [
          "AUTH-01",
          "AUTH-02",
          "AUTH-03",
          "AUTH-04",
          "FILE-01",
          "RPT-01",
          "RPT-02",
          "MAP-01",
          "STAT-01",
          "FB-01"
        ]
      }
    },
    "trace_id": "0000000000000000000000000000001a"
  },
  "AUTH-03": {
    "code": "OK",
    "message": "登出成功",
    "data": {
      "revoked": true
    },
    "trace_id": "00000000000000000000000000000039"
  },
  "AUTH-04": {
    "code": "OK",
    "message": "会话有效",
    "data": {
      "session_status": "ACTIVE",
      "account_profile": {
        "account_id": "user_r1",
        "account_status": "ACTIVE",
        "roles": [
          "R1"
        ]
      },
      "permission_summary": {
        "roles": [
          "R1"
        ],
        "permissions": [
          "AUTH-01",
          "AUTH-02",
          "AUTH-03",
          "AUTH-04",
          "FILE-01",
          "RPT-01",
          "RPT-02",
          "MAP-01",
          "STAT-01",
          "FB-01"
        ]
      },
      "expires_at": "2026-11-05T00:00:00Z"
    },
    "trace_id": "0000000000000000000000000000003d"
  },
  "FILE-01": {
    "code": "OK",
    "message": "上传凭证已签发",
    "data": {
      "upload_ticket": "up_YIr5ug0hZnvQxrj2yjDOeQQPz3P5VxcOvLJHWvnCT-Y",
      "media_ref": "med_00000000000f",
      "expires_at": "2026-11-04T12:15:00Z"
    },
    "trace_id": "00000000000000000000000000000040"
  },
  "RPT-01": {
    "code": "OK",
    "message": "上报已受理",
    "data": {
      "report_id": "RPT-000000000013",
      "report_status": "SUBMITTED",
      "matched_section_id": "SEC-001"
    },
    "trace_id": "00000000000000000000000000000046"
  },
  "RPT-02": {
    "code": "OK",
    "message": "查询成功",
    "data": {
      "items": [
        {
          "report_id": "RPT-00000000002f",
          "report_status": "SUBMITTED",
          "work_order_status": "PENDING_DISPATCH",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-00000000002b",
          "report_status": "SUBMITTED",
          "work_order_status": "PENDING_DISPATCH",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-000000000027",
          "report_status": "UNDER_REVIEW",
          "work_order_status": "PENDING_DISPATCH",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-000000000023",
          "report_status": "SUBMITTED",
          "work_order_status": "PENDING_DISPATCH",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-00000000001f",
          "report_status": "UNDER_REVIEW",
          "work_order_status": "PENDING_DISPATCH",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-00000000001b",
          "report_status": "UNDER_REVIEW",
          "work_order_status": "PENDING_DISPATCH",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-000000000017",
          "report_status": "REJECTED",
          "work_order_status": "CANCELLED",
          "progress_stage": "SUBMITTED",
          "closed": false,
          "submitted_at": "2026-11-04T12:00:00Z"
        },
        {
          "report_id": "RPT-000000000013",
          "report_status": "APPROVED",
          "work_order_status": "CLOSED",
          "progress_stage": "COMPLETED",
          "closed": true,
          "submitted_at": "2026-11-04T12:00:00Z"
        }
      ],
      "total": 8,
      "has_more": false
    },
    "trace_id": "0000000000000000000000000000007f"
  },
  "MAP-01": {
    "code": "OK",
    "message": "查询成功",
    "data": {
      "sections": [
        {
          "section_id": "SEC-001",
          "name": "示例岸段一",
          "coarse_lat": 36.06,
          "coarse_lng": 103.83,
          "heat_value": 1,
          "cleanup_kg_total": 12.5,
          "responsible_org": "ORG-YR-01"
        },
        {
          "section_id": "SEC-002",
          "name": "示例岸段二",
          "coarse_lat": 36.58,
          "coarse_lng": 103.23,
          "heat_value": 0,
          "cleanup_kg_total": 0.0,
          "responsible_org": "ORG-YR-02"
        },
        {
          "section_id": "SEC-003",
          "name": "示例岸段三",
          "coarse_lat": 35.6,
          "coarse_lng": 103.03,
          "heat_value": 0,
          "cleanup_kg_total": 0.0,
          "responsible_org": "ORG-YR-01"
        }
      ],
      "map_audit_no": "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO",
      "coarsen_degree": 0.01,
      "total": 3,
      "has_more": false
    },
    "trace_id": "00000000000000000000000000000083"
  },
  "WO-01": {
    "code": "OK",
    "message": "工单已转派",
    "data": {
      "work_order_id": "WO-000000000014",
      "work_order_status": "DISPATCHED"
    },
    "trace_id": "0000000000000000000000000000006e"
  },
  "WO-02": {
    "code": "OK",
    "message": "工单已办结",
    "data": {
      "work_order_id": "WO-000000000014",
      "work_order_status": "CLOSED",
      "closed": true,
      "progress_stage": "COMPLETED"
    },
    "trace_id": "00000000000000000000000000000074"
  },
  "REV-01": {
    "code": "OK",
    "message": "审核已记录",
    "data": {
      "review_status": "IN_PROGRESS",
      "review_record_id": "REV-000000000034",
      "next_review_level": "LEVEL_2"
    },
    "trace_id": "0000000000000000000000000000005e"
  },
  "STAT-01": {
    "code": "OK",
    "message": "查询成功",
    "data": {
      "metrics": [
        {
          "metric_key": "cleanup_kg_total",
          "value": 12.5,
          "unit": "kg",
          "sample_size": 1,
          "published": true
        },
        {
          "metric_key": "approved_report_count",
          "value": 1,
          "unit": "count",
          "sample_size": 1,
          "published": true
        },
        {
          "metric_key": "closed_work_order_count",
          "value": 1,
          "unit": "count",
          "sample_size": 1,
          "published": true
        }
      ],
      "leaderboard_enabled": false
    },
    "trace_id": "00000000000000000000000000000084"
  },
  "FB-01": {
    "code": "OK",
    "message": "评价已提交",
    "data": {
      "feedback_id": "FB-000000000045"
    },
    "trace_id": "0000000000000000000000000000007a"
  },
  "ADM-01": {
    "code": "OK",
    "message": "查询成功",
    "data": {
      "waste_categories": [
        {
          "code": "RECYCLABLE",
          "label": "可回收物",
          "description": "可回收利用的纸、塑料、金属、玻璃等"
        },
        {
          "code": "HAZARDOUS",
          "label": "有害垃圾",
          "description": "电池、灯管、药品等需要安全处置的垃圾"
        },
        {
          "code": "KITCHEN",
          "label": "厨余垃圾",
          "description": "易腐食物残余等"
        },
        {
          "code": "OTHER",
          "label": "其他垃圾",
          "description": "除上述类别外的岸线垃圾"
        }
      ],
      "sections": [
        {
          "section_id": "SEC-001",
          "name": "示例岸段一",
          "responsible_org": "ORG-YR-01"
        },
        {
          "section_id": "SEC-002",
          "name": "示例岸段二",
          "responsible_org": "ORG-YR-02"
        },
        {
          "section_id": "SEC-003",
          "name": "示例岸段三",
          "responsible_org": "ORG-YR-01"
        }
      ],
      "status_enums": [
        {
          "enum_name": "account_status",
          "values": [
            {
              "value": "ACTIVE",
              "label": "正常"
            },
            {
              "value": "DISABLED",
              "label": "已停用"
            }
          ]
        },
        {
          "enum_name": "session_status",
          "values": [
            {
              "value": "ACTIVE",
              "label": "有效"
            },
            {
              "value": "EXPIRED",
              "label": "已过期"
            },
            {
              "value": "REVOKED",
              "label": "已注销"
            }
          ]
        },
        {
          "enum_name": "report_status",
          "values": [
            {
              "value": "SUBMITTED",
              "label": "已提交"
            },
            {
              "value": "UNDER_REVIEW",
              "label": "审核中"
            },
            {
              "value": "APPROVED",
              "label": "审核通过"
            },
            {
              "value": "REJECTED",
              "label": "审核不通过"
            },
            {
              "value": "RETURNED",
              "label": "已退回"
            }
          ]
        },
        {
          "enum_name": "review_status",
          "values": [
            {
              "value": "PENDING",
              "label": "待审核"
            },
            {
              "value": "IN_PROGRESS",
              "label": "审核中"
            },
            {
              "value": "APPROVED",
              "label": "审核通过"
            },
            {
              "value": "REJECTED",
              "label": "审核不通过"
            },
            {
              "value": "RETURNED",
              "label": "已退回"
            }
          ]
        },
        {
          "enum_name": "review_level",
          "values": [
            {
              "value": "LEVEL_1",
              "label": "初审"
            },
            {
              "value": "LEVEL_2",
              "label": "复审"
            },
            {
              "value": "LEVEL_3",
              "label": "终审"
            }
          ]
        },
        {
          "enum_name": "review_result",
          "values": [
            {
              "value": "APPROVED",
              "label": "通过"
            },
            {
              "value": "REJECTED",
              "label": "不通过"
            },
            {
              "value": "RETURNED",
              "label": "退回"
            }
          ]
        },
        {
          "enum_name": "work_order_status",
          "values": [
            {
              "value": "PENDING_DISPATCH",
              "label": "待派单"
            },
            {
              "value": "DISPATCHED",
              "label": "已派单"
            },
            {
              "value": "CLOSED",
              "label": "已办结"
            },
            {
              "value": "CANCELLED",
              "label": "已取消"
            }
          ]
        },
        {
          "enum_name": "progress_stage",
          "values": [
            {
              "value": "SUBMITTED",
              "label": "已上报"
            },
            {
              "value": "IN_PROGRESS",
              "label": "处理中"
            },
            {
              "value": "COMPLETED",
              "label": "已办结"
            }
          ]
        },
        {
          "enum_name": "media_type",
          "values": [
            {
              "value": "IMAGE_JPEG",
              "label": "JPEG 图片"
            },
            {
              "value": "IMAGE_PNG",
              "label": "PNG 图片"
            },
            {
              "value": "VIDEO_MP4",
              "label": "MP4 视频"
            }
          ]
        },
        {
          "enum_name": "media_status",
          "values": [
            {
              "value": "RESERVED",
              "label": "已登记"
            },
            {
              "value": "UPLOADED",
              "label": "已上传"
            },
            {
              "value": "REJECTED",
              "label": "已拒绝"
            }
          ]
        },
        {
          "enum_name": "target_type",
          "values": [
            {
              "value": "REPORT",
              "label": "上报线索"
            }
          ]
        },
        {
          "enum_name": "scale_level",
          "values": [
            {
              "value": "SMALL",
              "label": "小型"
            },
            {
              "value": "MEDIUM",
              "label": "中型"
            },
            {
              "value": "LARGE",
              "label": "大型"
            }
          ]
        },
        {
          "enum_name": "role_code",
          "values": [
            {
              "value": "R0",
              "label": "匿名用户"
            },
            {
              "value": "R1",
              "label": "公众注册用户"
            },
            {
              "value": "R2",
              "label": "责任单位操作员"
            },
            {
              "value": "R3",
              "label": "初审员"
            },
            {
              "value": "R4",
              "label": "复审员"
            },
            {
              "value": "R5",
              "label": "终审员"
            },
            {
              "value": "R6",
              "label": "运营管理员"
            },
            {
              "value": "R7",
              "label": "系统管理员"
            },
            {
              "value": "R8",
              "label": "审计员"
            }
          ]
        },
        {
          "enum_name": "metric_key",
          "values": [
            {
              "value": "cleanup_kg_total",
              "label": "已办结工单清理量合计"
            },
            {
              "value": "approved_report_count",
              "label": "审核通过上报数"
            },
            {
              "value": "closed_work_order_count",
              "label": "已办结工单数"
            }
          ]
        }
      ],
      "coarsen_degree": 0.01,
      "leaderboard_enabled": false,
      "map_audit_no": null
    },
    "trace_id": "0000000000000000000000000000000c"
  }
};

/* 本地演示辅助数据（编号、角色、审图号占位说明） */
window.__HH_DEMO_IDS__ = {
  "generated_at": "2026-11-04T15:17:19Z",
  "period": "2026-11",
  "map_audit_no": "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO",
  "accounts": [
    {
      "account_id": "auditor",
      "roles": [
        "R1",
        "R8"
      ],
      "org_ids": []
    },
    {
      "account_id": "ops_admin",
      "roles": [
        "R1",
        "R6"
      ],
      "org_ids": []
    },
    {
      "account_id": "org_a_op",
      "roles": [
        "R1",
        "R2"
      ],
      "org_ids": [
        "ORG-YR-01"
      ]
    },
    {
      "account_id": "org_b_op",
      "roles": [
        "R1",
        "R2"
      ],
      "org_ids": [
        "ORG-YR-02"
      ]
    },
    {
      "account_id": "rev_l1",
      "roles": [
        "R1",
        "R3"
      ],
      "org_ids": []
    },
    {
      "account_id": "rev_l2",
      "roles": [
        "R1",
        "R4"
      ],
      "org_ids": []
    },
    {
      "account_id": "rev_l3",
      "roles": [
        "R1",
        "R5"
      ],
      "org_ids": []
    },
    {
      "account_id": "rev_multi",
      "roles": [
        "R1",
        "R3",
        "R4"
      ],
      "org_ids": []
    },
    {
      "account_id": "sys_admin",
      "roles": [
        "R1",
        "R7"
      ],
      "org_ids": []
    },
    {
      "account_id": "user_r1",
      "roles": [
        "R1"
      ],
      "org_ids": []
    }
  ],
  "reports": [
    {
      "report_id": "RPT-73ea5d632927",
      "owner_account_id": "ops_admin",
      "report_status": "APPROVED",
      "review_status": "APPROVED",
      "current_review_level": null,
      "work_order_id": "WO-e234b7e296bf",
      "work_order_status": "CLOSED",
      "closed": true,
      "section_id": "SEC-001",
      "assigned_org_id": "ORG-YR-01"
    },
    {
      "report_id": "RPT-aed6957d9be5",
      "owner_account_id": "ops_admin",
      "report_status": "UNDER_REVIEW",
      "review_status": "IN_PROGRESS",
      "current_review_level": "LEVEL_2",
      "work_order_id": "WO-2b7f5c03e8be",
      "work_order_status": "PENDING_DISPATCH",
      "closed": false,
      "section_id": "SEC-001",
      "assigned_org_id": null
    },
    {
      "report_id": "RPT-d12d66dde20c",
      "owner_account_id": "ops_admin",
      "report_status": "SUBMITTED",
      "review_status": "PENDING",
      "current_review_level": "LEVEL_1",
      "work_order_id": "WO-c1ed901d00b5",
      "work_order_status": "PENDING_DISPATCH",
      "closed": false,
      "section_id": "SEC-002",
      "assigned_org_id": null
    },
    {
      "report_id": "RPT-8e5c2d0eecb3",
      "owner_account_id": "ops_admin",
      "report_status": "REJECTED",
      "review_status": "REJECTED",
      "current_review_level": null,
      "work_order_id": "WO-711c5f5d449a",
      "work_order_status": "CANCELLED",
      "closed": false,
      "section_id": "SEC-003",
      "assigned_org_id": null
    },
    {
      "report_id": "RPT-e1d254a56778",
      "owner_account_id": "user_r1",
      "report_status": "SUBMITTED",
      "review_status": "PENDING",
      "current_review_level": "LEVEL_1",
      "work_order_id": "WO-2e3a2c3d5c86",
      "work_order_status": "PENDING_DISPATCH",
      "closed": false,
      "section_id": "SEC-001",
      "assigned_org_id": null
    },
    {
      "report_id": "RPT-4e728d9208f1",
      "owner_account_id": "user_r1",
      "report_status": "APPROVED",
      "review_status": "APPROVED",
      "current_review_level": null,
      "work_order_id": "WO-048e133a8762",
      "work_order_status": "CLOSED",
      "closed": true,
      "section_id": "SEC-002",
      "assigned_org_id": "ORG-YR-02"
    },
    {
      "report_id": "RPT-d12d0027e449",
      "owner_account_id": "ops_admin",
      "report_status": "UNDER_REVIEW",
      "review_status": "IN_PROGRESS",
      "current_review_level": "LEVEL_2",
      "work_order_id": "WO-84be7de81078",
      "work_order_status": "DISPATCHED",
      "closed": false,
      "section_id": "SEC-001",
      "assigned_org_id": "ORG-YR-01"
    },
    {
      "report_id": "RPT-1ac252a9c5fa",
      "owner_account_id": "ops_admin",
      "report_status": "SUBMITTED",
      "review_status": "PENDING",
      "current_review_level": "LEVEL_1",
      "work_order_id": "WO-168831885851",
      "work_order_status": "PENDING_DISPATCH",
      "closed": false,
      "section_id": "SEC-003",
      "assigned_org_id": null
    },
    {
      "report_id": "RPT-c5a622a2fa45",
      "owner_account_id": "ops_admin",
      "report_status": "UNDER_REVIEW",
      "review_status": "IN_PROGRESS",
      "current_review_level": "LEVEL_3",
      "work_order_id": "WO-c5b3e276ab1e",
      "work_order_status": "PENDING_DISPATCH",
      "closed": false,
      "section_id": "SEC-002",
      "assigned_org_id": null
    }
  ],
  "targets": {
    "review_level_1": [
      {
        "report_id": "RPT-d12d66dde20c",
        "owner_account_id": "ops_admin",
        "report_status": "SUBMITTED",
        "review_status": "PENDING",
        "current_review_level": "LEVEL_1",
        "work_order_id": "WO-c1ed901d00b5",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-002",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-e1d254a56778",
        "owner_account_id": "user_r1",
        "report_status": "SUBMITTED",
        "review_status": "PENDING",
        "current_review_level": "LEVEL_1",
        "work_order_id": "WO-2e3a2c3d5c86",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-001",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-1ac252a9c5fa",
        "owner_account_id": "ops_admin",
        "report_status": "SUBMITTED",
        "review_status": "PENDING",
        "current_review_level": "LEVEL_1",
        "work_order_id": "WO-168831885851",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-003",
        "assigned_org_id": null
      }
    ],
    "review_level_2": [
      {
        "report_id": "RPT-aed6957d9be5",
        "owner_account_id": "ops_admin",
        "report_status": "UNDER_REVIEW",
        "review_status": "IN_PROGRESS",
        "current_review_level": "LEVEL_2",
        "work_order_id": "WO-2b7f5c03e8be",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-001",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-d12d0027e449",
        "owner_account_id": "ops_admin",
        "report_status": "UNDER_REVIEW",
        "review_status": "IN_PROGRESS",
        "current_review_level": "LEVEL_2",
        "work_order_id": "WO-84be7de81078",
        "work_order_status": "DISPATCHED",
        "closed": false,
        "section_id": "SEC-001",
        "assigned_org_id": "ORG-YR-01"
      }
    ],
    "review_level_3": [
      {
        "report_id": "RPT-c5a622a2fa45",
        "owner_account_id": "ops_admin",
        "report_status": "UNDER_REVIEW",
        "review_status": "IN_PROGRESS",
        "current_review_level": "LEVEL_3",
        "work_order_id": "WO-c5b3e276ab1e",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-002",
        "assigned_org_id": null
      }
    ],
    "dispatch": [
      {
        "report_id": "RPT-aed6957d9be5",
        "owner_account_id": "ops_admin",
        "report_status": "UNDER_REVIEW",
        "review_status": "IN_PROGRESS",
        "current_review_level": "LEVEL_2",
        "work_order_id": "WO-2b7f5c03e8be",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-001",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-d12d66dde20c",
        "owner_account_id": "ops_admin",
        "report_status": "SUBMITTED",
        "review_status": "PENDING",
        "current_review_level": "LEVEL_1",
        "work_order_id": "WO-c1ed901d00b5",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-002",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-e1d254a56778",
        "owner_account_id": "user_r1",
        "report_status": "SUBMITTED",
        "review_status": "PENDING",
        "current_review_level": "LEVEL_1",
        "work_order_id": "WO-2e3a2c3d5c86",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-001",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-1ac252a9c5fa",
        "owner_account_id": "ops_admin",
        "report_status": "SUBMITTED",
        "review_status": "PENDING",
        "current_review_level": "LEVEL_1",
        "work_order_id": "WO-168831885851",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-003",
        "assigned_org_id": null
      },
      {
        "report_id": "RPT-c5a622a2fa45",
        "owner_account_id": "ops_admin",
        "report_status": "UNDER_REVIEW",
        "review_status": "IN_PROGRESS",
        "current_review_level": "LEVEL_3",
        "work_order_id": "WO-c5b3e276ab1e",
        "work_order_status": "PENDING_DISPATCH",
        "closed": false,
        "section_id": "SEC-002",
        "assigned_org_id": null
      }
    ],
    "close": [
      {
        "report_id": "RPT-d12d0027e449",
        "owner_account_id": "ops_admin",
        "report_status": "UNDER_REVIEW",
        "review_status": "IN_PROGRESS",
        "current_review_level": "LEVEL_2",
        "work_order_id": "WO-84be7de81078",
        "work_order_status": "DISPATCHED",
        "closed": false,
        "section_id": "SEC-001",
        "assigned_org_id": "ORG-YR-01"
      }
    ],
    "feedback": [
      {
        "work_order_id": "WO-e234b7e296bf",
        "report_id": "RPT-73ea5d632927",
        "cleanup_weight_kg": 12.5
      },
      {
        "work_order_id": "WO-048e133a8762",
        "report_id": "RPT-4e728d9208f1",
        "cleanup_weight_kg": 8.0
      }
    ]
  },
  "notes": [
    "演示辅助数据，不是契约接口，不得作为生产数据源。",
    "SAMPLE-ONLY 审图号仅用于本地演示；生产必须配置授权审图号。",
    "上报/审核/工单状态均为后端服务实际产生；本文件只读导出 ID。"
  ]
};
