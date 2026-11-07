# 权威响应样例索引

- contract_version：`1.0.0`（提议冻结版本，待双方确认）
- 夹具时钟：`2026-11-04T12:00:00Z`（UTC）
- 样例数量：69
- 参考调用信封仅用于本侧自测，不代表 T2 已确定的通信风格/地址/序列化。
- 样例中的凭证类取值均为一次性夹具；夹具库已在生成后删除。
- `MAP-01` 的“带审图号”与 `STAT-01` 的“榜单开启”为**仅样例夹具**；生产默认 `map_audit_no=null`（不下发点位）且 `leaderboard_enabled=false`。

## 逐接口索引

| # | 接口 | 场景 | code | 类别 | trace_id | 文件 | 说明 |
|---|---|---|---|---|---|---|---|
| 1 | ADM-01 | success | `OK` | OK | `0000000000000000000000000000000c` | `ADM-01/success.json` | 默认配置：map_audit_no=null、leaderboard_enabled=false。；sections 仅含 section_id/name/responsible_org，不含任何坐标。；status_enums 同时承载 scale_level/role_code/metric_key（契约未提供独立字段，见 CR）。 |
| 2 | ADM-01 | error_perm_role_required | `PERM_ROLE_REQUIRED` | PERM | `0000000000000000000000000000000d` | `ADM-01/error_perm_role_required.json` | R1 无权读取运营/字典配置。 |
| 3 | ADM-01 | error_param_invalid_scope | `PARAM_INVALID_SCOPE` | PARAM | `0000000000000000000000000000000e` | `ADM-01/error_param_invalid_scope.json` | config_scope 当前仅接受 ALL，取值空间待 CR 确认。 |
| 4 | MAP-01 | success_default_no_audit_no | `OK` | OK | `0000000000000000000000000000000f` | `MAP-01/success_default_no_audit_no.json` | 合规闸门：map_audit_no 缺失时 sections=[]，不下发任何点位。；coarsen_degree 仍下发 0.01，供前端理解粗化口径。 |
| 5 | MAP-01 | error_param_invalid_period | `PARAM_INVALID_PERIOD` | PARAM | `00000000000000000000000000000010` | `MAP-01/error_param_invalid_period.json` | period 参考支持 YYYY-MM 与 YYYY-Www（T12 未确认）。 |
| 6 | MAP-01 | error_param_invalid_pagination | `PARAM_INVALID_PAGINATION` | PARAM | `00000000000000000000000000000011` | `MAP-01/error_param_invalid_pagination.json` | page_size 上限由后端定义为 100。 |
| 7 | STAT-01 | success_no_data | `OK` | OK | `00000000000000000000000000000012` | `STAT-01/success_no_data.json` | metric_keys 为空表示返回全部受支持指标；零样本 published=false，榜单默认关闭。 |
| 8 | STAT-01 | error_param_unknown_metric | `PARAM_UNKNOWN_METRIC_KEY` | PARAM | `00000000000000000000000000000013` | `STAT-01/error_param_unknown_metric.json` | 受支持指标键见交付说明与 ADM-01 的 metric_key 枚举。 |
| 9 | AUTH-01 | success | `OK` | OK | `00000000000000000000000000000014` | `AUTH-01/success.json` | 请求快照中的 credential/verify_token 已脱敏；响应不回显凭证。；默认角色 R1；注册幂等键为可选（契约 §4.1 与 §4.2 存在张力，见 CR）。 |
| 10 | AUTH-01 | error_param_missing_field | `PARAM_MISSING_FIELD` | PARAM | `00000000000000000000000000000015` | `AUTH-01/error_param_missing_field.json` | 缺少 verify_token。 |
| 11 | AUTH-01 | error_auth_account_exists | `AUTH_ACCOUNT_EXISTS` | AUTH | `00000000000000000000000000000016` | `AUTH-01/error_auth_account_exists.json` | 注册的账号唯一性校验在后端；验证凭证先于唯一性校验。 |
| 12 | AUTH-01 | error_auth_verify_failed | `AUTH_VERIFY_FAILED` | AUTH | `00000000000000000000000000000017` | `AUTH-01/error_auth_verify_failed.json` | 验证凭证错误；不创建账号。 |
| 13 | AUTH-01 | error_param_agreement_required | `PARAM_AGREEMENT_REQUIRED` | PARAM | `00000000000000000000000000000018` | `AUTH-01/error_param_agreement_required.json` | 未接受用户协议。 |
| 14 | AUTH-01 | error_dep_verification_unavailable | `DEP_EXTERNAL_UNAVAILABLE` | DEP | `00000000000000000000000000000019` | `AUTH-01/error_dep_verification_unavailable.json` | 验证能力不可用时安全降级：返回 DEP，不创建账号，不跳过校验。 |
| 15 | AUTH-02 | success | `OK` | OK | `0000000000000000000000000000001a` | `AUTH-02/success.json` | 返回值仅用于界面裁剪；逐请求鉴权仍由后端完成。凭证不回显。 |
| 16 | AUTH-02 | error_auth_invalid | `AUTH_INVALID` | AUTH | `0000000000000000000000000000001b` | `AUTH-02/error_auth_invalid.json` | 错误码与文案对“账号不存在/凭证错误”统一，不泄露账号存在性。 |
| 17 | AUTH-02 | error_auth_locked | `AUTH_LOCKED` | AUTH | `00000000000000000000000000000021` | `AUTH-02/error_auth_locked.json` | 连续 5 次失败后第 6 次触发临时锁定；锁定按 account_id 输入统一施加。 |
| 18 | AUTH-02 | error_rate_limited | `RATE_LIMITED` | RATE | `00000000000000000000000000000036` | `AUTH-02/error_rate_limited.json` | 21 次/60s 的登录尝试触发限流；前 20 次未在样例中展示。 |
| 19 | AUTH-03 | success_current | `OK` | OK | `00000000000000000000000000000039` | `AUTH-03/success_current.json` | 登出幂等：已过期/已注销/未知句柄同样返回 revoked=true，不暴露会话存在性。 |
| 20 | AUTH-03 | success_all | `OK` | OK | `0000000000000000000000000000003a` | `AUTH-03/success_all.json` | ALL 撤销该账号全部有效会话。 |
| 21 | AUTH-03 | success_idempotent_replay | `OK` | OK | `0000000000000000000000000000003b` | `AUTH-03/success_idempotent_replay.json` | 重复登出返回一致结果。 |
| 22 | AUTH-03 | error_param_invalid_scope | `PARAM_INVALID_ENUM` | PARAM | `0000000000000000000000000000003c` | `AUTH-03/error_param_invalid_scope.json` | scope 仅接受 CURRENT/ALL。 |
| 23 | AUTH-04 | success | `OK` | OK | `0000000000000000000000000000003d` | `AUTH-04/success.json` | session_status 成功查询时为 ACTIVE；过期/注销走 AUTH_* 错误并清理凭证。 |
| 24 | AUTH-04 | error_auth_session_required | `AUTH_SESSION_REQUIRED` | AUTH | `0000000000000000000000000000003e` | `AUTH-04/error_auth_session_required.json` | 缺少会话句柄。 |
| 25 | AUTH-04 | error_auth_session_invalid | `AUTH_SESSION_INVALID` | AUTH | `0000000000000000000000000000003f` | `AUTH-04/error_auth_session_invalid.json` | 未知句柄；与过期/注销使用不同 AUTH_* 码，前端统一清理凭证回匿名态。 |
| 26 | FILE-01 | success | `OK` | OK | `00000000000000000000000000000040` | `FILE-01/success.json` | 凭证限时 15 分钟；审核前媒体不对外；media_ref 用于后续上报/办结引用。 |
| 27 | FILE-01 | success_idempotent_replay | `OK` | OK | `00000000000000000000000000000042` | `FILE-01/success_idempotent_replay.json` | 同一幂等键回放：media_ref 保持不变，upload_ticket 重新签发，旧凭证失效。；幂等记录只保存 media_ref，不在库中保存上传凭证明文。 |
| 28 | FILE-01 | error_param_invalid_media_type | `PARAM_INVALID_MEDIA_TYPE` | PARAM | `00000000000000000000000000000043` | `FILE-01/error_param_invalid_media_type.json` | media_type 取值见 ADM-01 的 media_type 枚举。 |
| 29 | FILE-01 | error_param_size_exceeded | `PARAM_MEDIA_SIZE_EXCEEDED` | PARAM | `00000000000000000000000000000044` | `FILE-01/error_param_size_exceeded.json` | JPEG/PNG 上限 10MB，MP4 上限 100MB（参考值）。 |
| 30 | FILE-01 | error_auth_session_required | `AUTH_SESSION_REQUIRED` | AUTH | `00000000000000000000000000000045` | `FILE-01/error_auth_session_required.json` | 取上传凭证需要已认证。 |
| 31 | RPT-01 | success | `OK` | OK | `00000000000000000000000000000046` | `RPT-01/success.json` | raw_lat/raw_lng 仅上行；响应不含原始坐标。；matched_section_id 由后端按岸段中心距离匹配（参考阈值 5km）。；AI 初判不可用时 ai_status=UNAVAILABLE，上报仍受理，人工审核不被绕过。 |
| 32 | RPT-01 | success_idempotent_replay | `OK` | OK | `00000000000000000000000000000047` | `RPT-01/success_idempotent_replay.json` | 同一幂等键/同内容回放：report_id 不变，不产生重复上报。 |
| 33 | RPT-01 | error_param_missing_field | `PARAM_MISSING_FIELD` | PARAM | `00000000000000000000000000000048` | `RPT-01/error_param_missing_field.json` | 缺少 media_refs。 |
| 34 | RPT-01 | error_param_invalid_coordinate | `PARAM_INVALID_COORDINATE` | PARAM | `00000000000000000000000000000049` | `RPT-01/error_param_invalid_coordinate.json` | 坐标范围全量重校验；错误文案不回显坐标值。 |
| 35 | RPT-01 | error_param_unknown_field | `PARAM_UNKNOWN_FIELD` | PARAM | `0000000000000000000000000000004a` | `RPT-01/error_param_unknown_field.json` | 前端不得传入 closed/report_status 等权威状态字段；契约外字段一律拒绝。 |
| 36 | RPT-01 | error_auth_session_required | `AUTH_SESSION_REQUIRED` | AUTH | `0000000000000000000000000000004b` | `RPT-01/error_auth_session_required.json` | Q1 建议默认值：上报需登录（待确认，见交付说明）。 |
| 37 | RPT-01 | error_param_invalid_media_ref | `PARAM_INVALID_VALUE` | PARAM | `0000000000000000000000000000005c` | `RPT-01/error_param_invalid_media_ref.json` | 媒体引用必须存在、属于当前账号且处于可用状态；统一失败文案。 |
| 38 | REV-01 | error_state_review_level_mismatch | `STATE_REVIEW_LEVEL_MISMATCH` | STATE | `0000000000000000000000000000005d` | `REV-01/error_state_review_level_mismatch.json` | 当前应审 LEVEL_1，请求 LEVEL_3；级别流转由后端裁决。 |
| 39 | REV-01 | success_level_1 | `OK` | OK | `0000000000000000000000000000005e` | `REV-01/success_level_1.json` | L1 通过后 next_review_level=LEVEL_2。 |
| 40 | REV-01 | error_perm_role_required | `PERM_ROLE_REQUIRED` | PERM | `0000000000000000000000000000005f` | `REV-01/error_perm_role_required.json` | LEVEL_2 仅 R4 复审员可执行；R3 即使持有会话也被拒。 |
| 41 | REV-01 | success_level_2 | `OK` | OK | `00000000000000000000000000000060` | `REV-01/success_level_2.json` | L2 通过后 next_review_level=LEVEL_3。 |
| 42 | REV-01 | success_level_3_final | `OK` | OK | `00000000000000000000000000000061` | `REV-01/success_level_3_final.json` | 三级全部通过后才置 APPROVED，且此后才计入热力。 |
| 43 | REV-01 | error_perm_sod_violation | `PERM_SOD_VIOLATION` | PERM | `00000000000000000000000000000063` | `REV-01/error_perm_sod_violation.json` | 同一审核人不得连续执行两级；即时拒绝并审计。 |
| 44 | REV-01 | success_returned | `OK` | OK | `00000000000000000000000000000065` | `REV-01/success_returned.json` | L2 退回后 next_review_level=LEVEL_1，可重新走审核流程。 |
| 45 | REV-01 | success_rewalk_level_1 | `OK` | OK | `00000000000000000000000000000066` | `REV-01/success_rewalk_level_1.json` | 退回后可重走；连续两级仍受 SoD 约束。 |
| 46 | REV-01 | error_perm_sod_admin_final | `PERM_SOD_VIOLATION` | PERM | `0000000000000000000000000000006a` | `REV-01/error_perm_sod_admin_final.json` | 系统管理员不兼终审；R7/R5 角色在配给层也被数据库触发器互斥。 |
| 47 | REV-01 | success_rejected | `OK` | OK | `0000000000000000000000000000006c` | `REV-01/success_rejected.json` | 不通过为终态；关联未办结工单被取消。 |
| 48 | REV-01 | error_param_invalid_target_type | `PARAM_INVALID_ENUM` | PARAM | `0000000000000000000000000000006d` | `REV-01/error_param_invalid_target_type.json` | v1.0.0 仅有 REPORT 目标；科普内容审核接口缺失，见 CR。 |
| 49 | WO-01 | success | `OK` | OK | `0000000000000000000000000000006e` | `WO-01/success.json` | 转派含首次派单；状态机合法性由后端裁决。 |
| 50 | WO-01 | error_perm_role_required | `PERM_ROLE_REQUIRED` | PERM | `0000000000000000000000000000006f` | `WO-01/error_perm_role_required.json` | 仅 R6 运营管理员可转派。 |
| 51 | WO-01 | error_param_target_not_found | `PARAM_TARGET_NOT_FOUND` | PARAM | `00000000000000000000000000000070` | `WO-01/error_param_target_not_found.json` | R6 对不存在的工单返回目标不存在；资源级越权对 R2 使用统一拒绝。 |
| 52 | WO-02 | success | `OK` | OK | `00000000000000000000000000000074` | `WO-02/success.json` | 仅已派单工单可办结；cleanup_weight_kg>0 才 closed=true。；办结、清理记录、证据关系、审计与幂等记录同事务提交。 |
| 53 | WO-02 | success_idempotent_replay | `OK` | OK | `00000000000000000000000000000075` | `WO-02/success_idempotent_replay.json` | 同一幂等键回放：closed=true、progress_stage=COMPLETED 一致，不新增清理记录。 |
| 54 | WO-02 | error_param_invalid_weight | `PARAM_INVALID_WEIGHT` | PARAM | `00000000000000000000000000000076` | `WO-02/error_param_invalid_weight.json` | 清理量必须 >0 且最多 3 位小数；不写入任何清理记录。 |
| 55 | WO-02 | error_perm_resource_forbidden | `PERM_RESOURCE_FORBIDDEN` | PERM | `00000000000000000000000000000077` | `WO-02/error_perm_resource_forbidden.json` | R2 仅能操作本组织责任工单；不暴露工单是否存在。 |
| 56 | WO-02 | error_state_invalid_transition | `STATE_INVALID_TRANSITION` | STATE | `00000000000000000000000000000078` | `WO-02/error_state_invalid_transition.json` | 待派单工单不允许直接办结。 |
| 57 | WO-01 | error_state_invalid_transition | `STATE_INVALID_TRANSITION` | STATE | `00000000000000000000000000000079` | `WO-01/error_state_invalid_transition.json` | 已办结工单不允许再次转派。 |
| 58 | FB-01 | success | `OK` | OK | `0000000000000000000000000000007a` | `FB-01/success.json` | 仅上报本人、且工单 closed=true 后允许评价。 |
| 59 | FB-01 | success_idempotent_replay | `OK` | OK | `0000000000000000000000000000007b` | `FB-01/success_idempotent_replay.json` | 同一幂等键回放：feedback_id 不变。 |
| 60 | FB-01 | error_state_feedback_duplicate | `STATE_FEEDBACK_DUPLICATE` | STATE | `0000000000000000000000000000007c` | `FB-01/error_state_feedback_duplicate.json` | 同一工单同一账号仅允许一次评价。 |
| 61 | FB-01 | error_state_closed_required | `STATE_CLOSED_REQUIRED` | STATE | `0000000000000000000000000000007d` | `FB-01/error_state_closed_required.json` | 未办结工单不允许评价。 |
| 62 | FB-01 | error_perm_resource_forbidden | `PERM_RESOURCE_FORBIDDEN` | PERM | `0000000000000000000000000000007e` | `FB-01/error_perm_resource_forbidden.json` | 非上报本人统一拒绝，不暴露资源存在性。 |
| 63 | RPT-02 | success | `OK` | OK | `0000000000000000000000000000007f` | `RPT-02/success.json` | closed/progress_stage 全由后端计算；原始坐标永不下行。；pagination 扩展 total/has_more 依据契约通则。 |
| 64 | RPT-02 | error_param_invalid_status | `PARAM_INVALID_ENUM` | PARAM | `00000000000000000000000000000080` | `RPT-02/error_param_invalid_status.json` | report_status 过滤值必须来自枚举字典。 |
| 65 | RPT-02 | error_auth_session_invalid | `AUTH_SESSION_INVALID` | AUTH | `00000000000000000000000000000081` | `RPT-02/error_auth_session_invalid.json` | 未知会话。 |
| 66 | MAP-01 | success_fixture_with_audit_no | `OK` | OK | `00000000000000000000000000000083` | `MAP-01/success_fixture_with_audit_no.json` | 仅样例夹具：显式配置了 SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO。；生产默认 map_audit_no=null，默认成功样例为 sections=[]。；仅 APPROVED 上报计入 heat_value；清理量来自已办结工单。；下行仅 coarse_lat/coarse_lng，粗化度 coarsen_degree=0.01。 |
| 67 | STAT-01 | success_with_data | `OK` | OK | `00000000000000000000000000000084` | `STAT-01/success_with_data.json` | metrics 含 sample_size/published；榜单默认关闭。 |
| 68 | STAT-01 | success_leaderboard_fixture_enabled | `OK` | OK | `00000000000000000000000000000086` | `STAT-01/success_leaderboard_fixture_enabled.json` | 仅样例夹具：已人工核实样本量并开启榜单。；契约当前无榜单数据承载字段，样例只体现 leaderboard_enabled；见 CR-002。 |
| 69 | MAP-01 | error_internal_error | `INTERNAL_ERROR` | INTERNAL | `00000000000000000000000000000088` | `MAP-01/error_internal_error.json` | 测试夹具注入故障；不存在可由请求触发的对应路径。响应不含堆栈与内部字段。 |

## 七类错误覆盖

- **PARAM**：`ADM-01/error_param_invalid_scope`, `MAP-01/error_param_invalid_period`, `MAP-01/error_param_invalid_pagination`, `STAT-01/error_param_unknown_metric`, `AUTH-01/error_param_missing_field`, `AUTH-01/error_param_agreement_required`, `AUTH-03/error_param_invalid_scope`, `FILE-01/error_param_invalid_media_type`, `FILE-01/error_param_size_exceeded`, `RPT-01/error_param_missing_field`, `RPT-01/error_param_invalid_coordinate`, `RPT-01/error_param_unknown_field`, `RPT-01/error_param_invalid_media_ref`, `REV-01/error_param_invalid_target_type`, `WO-01/error_param_target_not_found`, `WO-02/error_param_invalid_weight`, `RPT-02/error_param_invalid_status`
- **AUTH**：`AUTH-01/error_auth_account_exists`, `AUTH-01/error_auth_verify_failed`, `AUTH-02/error_auth_invalid`, `AUTH-02/error_auth_locked`, `AUTH-04/error_auth_session_required`, `AUTH-04/error_auth_session_invalid`, `FILE-01/error_auth_session_required`, `RPT-01/error_auth_session_required`, `RPT-02/error_auth_session_invalid`
- **PERM**：`ADM-01/error_perm_role_required`, `REV-01/error_perm_role_required`, `REV-01/error_perm_sod_violation`, `REV-01/error_perm_sod_admin_final`, `WO-01/error_perm_role_required`, `WO-02/error_perm_resource_forbidden`, `FB-01/error_perm_resource_forbidden`
- **STATE**：`REV-01/error_state_review_level_mismatch`, `WO-02/error_state_invalid_transition`, `WO-01/error_state_invalid_transition`, `FB-01/error_state_feedback_duplicate`, `FB-01/error_state_closed_required`
- **RATE**：`AUTH-02/error_rate_limited`
- **DEP**：`AUTH-01/error_dep_verification_unavailable`
- **INTERNAL**：`MAP-01/error_internal_error`

## 仅样例夹具说明

- MAP-01 的点位下发受 `map_audit_no` 缺失闸门控制；默认夹具不配置审图号，因此默认成功样例的 `sections` 为空。带点位的样例在生成时显式配置了 `SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO`，**不得**作为生产审图号使用。
- STAT-01 的榜单开启样例在生成时以人工核实样本量的夹具配置开启；契约当前未提供榜单数据承载字段，样例只体现开关，见契约变更请求 CR-002。
- INTERNAL 样例通过测试夹具注入故障，仅用于验证错误信封不泄露内部信息，不存在可由请求触发的对应路径。

## 请求信封示例

```json
{
  "api": "RPT-01",
  "session_handle": "<session_handle>",
  "idempotency_key": "<frontend-generated>",
  "payload": {
    "raw_lat": "<raw_lat-upstream-only>",
    "raw_lng": "<raw_lng-upstream-only>",
    "waste_category": "OTHER",
    "scale_level": "SMALL",
    "media_refs": [
      "med_..."
    ]
  }
}
```

