package publish

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"protoflow/server/migrations"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const mcpRichSnapshotV5 = `{
  "formatVersion": 5,
  "projectId": "proj-mcp-go",
  "title": "库存与订单协同原型",
  "entryPageId": "orders-page",
  "sitemap": [
    {
      "id": "folder-biz",
      "title": "订单业务",
      "type": "folder",
      "deprecated": false,
      "children": [
        { "id": "node-orders", "title": "订单审批台账", "type": "page", "deprecated": false, "pageId": "orders-page" },
        { "id": "node-audit", "title": "审计看板", "type": "page", "deprecated": false, "pageId": "audit-page" }
      ]
    }
  ],
  "pages": [
    {
      "pageId": "orders-page",
      "title": "订单审批台账",
      "folderId": "folder-biz",
      "doc": {
        "header": [],
        "root": {
          "kind": "node",
          "pfId": "root-page",
          "type": "Page",
          "props": { "title": "订单审批台账" },
          "children": [
            {
              "kind": "node",
              "pfId": "tbl-orders",
              "type": "Table",
              "props": {
                "table": "t_orders",
                "rowActions": [
                  {
                    "label": "通过",
                    "onClick": {
                      "$kind": "actions",
                      "calls": [{ "name": "updateRow", "args": [{ "status": "approved" }] }]
                    }
                  },
                  {
                    "label": "提醒并跳转",
                    "onClick": {
                      "$kind": "actions",
                      "calls": [
                        { "name": "toast", "args": ["已提交"] },
                        { "name": "navigate", "args": ["audit-page"] }
                      ]
                    }
                  }
                ]
              },
              "children": []
            }
          ]
        }
      }
    },
    {
      "pageId": "audit-page",
      "title": "审计看板",
      "folderId": "folder-biz",
      "doc": {
        "header": [],
        "root": {
          "kind": "node",
          "pfId": "audit-root",
          "type": "Page",
          "props": { "title": "审计看板" },
          "children": []
        }
      }
    }
  ],
  "tables": [
    {
      "id": "t_org",
      "tableName": "t_org",
      "cnName": "组织机构表",
      "domain": "主数据域",
      "description": "顶层组织机构",
      "sharedByMenus": [],
      "columns": [
        { "id": "org_id", "name": "id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "机构ID" },
        { "id": "org_region", "name": "region_code", "dataType": "VARCHAR(32)", "nullable": false, "comment": "非唯一大区编码" }
      ]
    },
    {
      "id": "t_tenant_member",
      "tableName": "t_tenant_member",
      "cnName": "租户成员关联表",
      "domain": "主数据域",
      "description": "复合主键父表",
      "sharedByMenus": [],
      "columns": [
        { "id": "tm_tenant", "name": "tenant_id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "租户ID" },
        { "id": "tm_member", "name": "member_id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "成员ID" }
      ]
    },
    {
      "id": "t_supplier",
      "tableName": "t_supplier",
      "cnName": "供应商表",
      "domain": "主数据域",
      "description": "合格供应商档案",
      "sharedByMenus": [],
      "columns": [
        { "id": "sup_id", "name": "id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "供应商ID" },
        { "id": "sup_org", "name": "org_id", "dataType": "VARCHAR(64)", "nullable": false, "isForeignKey": true, "references": "t_org(id)", "comment": "所属机构" }
      ]
    },
    {
      "id": "t_orders",
      "tableName": "t_orders",
      "cnName": "采购订单表",
      "domain": "交易域",
      "description": "采购订单主表",
      "uniqueConstraints": [
        { "name": "uq_supplier_order_code", "columnIds": ["c_sup", "c_code"] }
      ],
      "sharedByMenus": [
        { "pageId": "orders-page", "menuTitle": "订单审批台账", "accessMode": "STATE 状态流转", "fieldMappingNote": "审批通过" }
      ],
      "columns": [
        { "id": "c1", "name": "id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "主键" },
        { "id": "c_code", "name": "order_code", "dataType": "VARCHAR(64)", "nullable": false, "isUnique": true, "comment": "订单单号" },
        { "id": "c_sup", "name": "supplier_id", "dataType": "VARCHAR(64)", "nullable": false, "isForeignKey": true, "references": "t_supplier(id)", "comment": "供应商外键" },
        { "id": "c2", "name": "status", "dataType": "VARCHAR(32)", "nullable": false, "defaultValue": "pending", "comment": "审批状态" },
        { "id": "c_trace", "name": "trace_token", "dataType": "VARCHAR(64)", "nullable": false, "defaultValue": "gen_random_uuid()", "comment": "追踪表达式默认值" },
        { "id": "c_urgent", "name": "is_urgent", "dataType": "TINYINT(1)", "nullable": false, "defaultValue": "1", "comment": "是否加急" },
        { "id": "c_archived", "name": "is_archived", "dataType": "TINYINT(1)", "nullable": false, "defaultValue": "0", "comment": "是否归档" }
      ]
    },
    {
      "id": "t_audit_log",
      "tableName": "t_audit_log",
      "cnName": "审批审计日志",
      "domain": "安全域",
      "description": "仅通过菜单共表关联审计看板",
      "sharedByMenus": [
        { "pageId": "audit-page", "menuTitle": "审计看板", "accessMode": "READ 查询", "fieldMappingNote": "只读查询日志" }
      ],
      "columns": [
        { "id": "al_id", "name": "id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "日志ID" },
        { "id": "al_org", "name": "org_id", "dataType": "VARCHAR(64)", "nullable": false, "isForeignKey": true, "references": "t_org(id)", "comment": "所属机构" },
        { "id": "al_bad_fk", "name": "broken_ref", "dataType": "VARCHAR(64)", "nullable": true, "isForeignKey": true, "references": "t_org(nonexistent_col)", "comment": "指向不存在父列的外键" },
        { "id": "al_nonuniq_fk", "name": "region_ref", "dataType": "VARCHAR(32)", "nullable": true, "isForeignKey": true, "references": "t_org(region_code)", "comment": "指向非唯一父列的外键" },
        { "id": "al_comppk_fk", "name": "tenant_ref", "dataType": "VARCHAR(64)", "nullable": true, "isForeignKey": true, "references": "t_tenant_member(tenant_id)", "comment": "指向复合主键单列的外键" }
      ]
    }
  ],
  "tableRows": {
    "t_org": [{ "id": "org-1", "region_code": "EAST" }],
    "t_tenant_member": [{ "id": "tm-1", "tenant_id": "ten-1", "member_id": "mem-1" }],
    "t_supplier": [{ "id": "sup-1", "org_id": "org-1" }],
    "t_orders": [{ "id": "row-1", "order_code": "PO-001", "supplier_id": "sup-1", "status": "pending", "is_urgent": 1, "is_archived": 0 }],
    "t_audit_log": [{ "id": "log-1", "org_id": "org-1" }]
  },
  "stickyNotes": [
    {
      "id": "st-1",
      "pageId": "orders-page",
      "targetWidgetId": "tbl-orders",
      "targetWidgetName": "订单表格",
      "index": 1,
      "text": "审批通过后触发库存预占",
      "active": true
    }
  ],
  "notes": [
    {
      "noteId": "note-1",
      "title": "订单流转规范",
      "icon": "📝",
      "status": "confirmed",
      "updatedAt": "2026-11-18T10:00:00Z",
      "html": "<p>已通过订单不允许直接物理删除。</p>",
      "pageIds": ["orders-page"]
    }
  ]
}`

const mcpLegacySnapshotV3 = `{
  "formatVersion": 3,
  "projectId": "proj-legacy-v3",
  "title": "旧版V3原型",
  "entryPageId": "orders-page",
  "sitemap": [
    {
      "id": "folder-biz",
      "title": "订单业务",
      "type": "folder",
      "deprecated": false,
      "children": [
        { "id": "node-orders", "title": "订单页", "type": "page", "deprecated": false, "pageId": "orders-page" }
      ]
    }
  ],
  "pages": [
    {
      "pageId": "orders-page",
      "title": "订单页",
      "folderId": "folder-biz",
      "doc": {
        "header": [],
        "root": { "kind": "node", "pfId": "root", "type": "Page", "props": {}, "children": [] }
      }
    }
  ],
  "tables": [
    {
      "id": "t_orders",
      "tableName": "t_orders",
      "cnName": "订单表",
      "domain": "交易域",
      "description": "",
      "sharedByMenus": [],
      "columns": [
        { "id": "c1", "name": "id", "dataType": "VARCHAR(64)", "nullable": false, "isPrimaryKey": true, "comment": "ID" }
      ]
    }
  ],
  "tableRows": { "t_orders": [] },
  "stickyNotes": []
}`

func TestFormat5ValidationRules(t *testing.T) {
	if _, err := ValidateSnapshot(json.RawMessage(mcpRichSnapshotV5)); err != nil {
		t.Fatalf("expected V5 snapshot with isUnique and uniqueConstraints to pass validation, got: %v", err)
	}

	// V3 must reject uniqueConstraints or isUnique
	v3WithUnique := strings.Replace(mcpLegacySnapshotV3, `"isPrimaryKey": true`, `"isPrimaryKey": true, "isUnique": true`, 1)
	if _, err := ValidateSnapshot(json.RawMessage(v3WithUnique)); err == nil {
		t.Fatalf("expected V3 snapshot with column isUnique to be rejected")
	}

	// V5 duplicate unique constraint matching single-column isUnique must be rejected
	dupConstraint := strings.Replace(
		mcpRichSnapshotV5,
		`{ "name": "uq_supplier_order_code", "columnIds": ["c_sup", "c_code"] }`,
		`{ "name": "uq_dup_code", "columnIds": ["c_code"] }`,
		1,
	)
	if _, err := ValidateSnapshot(json.RawMessage(dupConstraint)); err == nil {
		t.Fatalf("expected V5 snapshot with redundant unique constraint to be rejected")
	}

	// [P1] V5 duplicate column IDs within the same table must be rejected so uniqueConstraints never bind to a shadowed column
	dupColID := strings.Replace(
		mcpRichSnapshotV5,
		`{ "id": "c2", "name": "status"`,
		`{ "id": "c_code", "name": "status"`,
		1,
	)
	if _, err := ValidateSnapshot(json.RawMessage(dupColID)); err == nil {
		t.Fatalf("expected V5 snapshot with duplicate column.id to be rejected")
	}

	// [P2] Server must reject V5 snapshots that PublishedViewer cannot open (e.g., uniqueConstraints: null, [null], empty cnName, icon > 16 UTF-16 units, null note fields, raw expressions, duplicate pfId)
	invalidViewerCases := map[string]string{
		"v5 uniqueConstraints null": strings.Replace(
			mcpRichSnapshotV5,
			`"uniqueConstraints": [
        { "name": "uq_supplier_order_code", "columnIds": ["c_sup", "c_code"] }
      ]`,
			`"uniqueConstraints": null`,
			1,
		),
		"v3 uniqueConstraints null": strings.Replace(
			mcpLegacySnapshotV3,
			`"sharedByMenus": []`,
			`"uniqueConstraints": null, "sharedByMenus": []`,
			1,
		),
		"v5 uniqueConstraints item null": strings.Replace(
			mcpRichSnapshotV5,
			`{ "name": "uq_supplier_order_code", "columnIds": ["c_sup", "c_code"] }`,
			`null`,
			1,
		),
		"v5 uniqueConstraints columnIds null": strings.Replace(
			mcpRichSnapshotV5,
			`["c_sup", "c_code"]`,
			`["c_sup", null]`,
			1,
		),
		"v5 empty cnName":                strings.Replace(mcpRichSnapshotV5, `"cnName": "采购订单表"`, `"cnName": "   "`, 1),
		"v5 isUnique null":               strings.Replace(mcpRichSnapshotV5, `"isUnique": true`, `"isUnique": null`, 1),
		"v5 note icon > 16 UTF-16 units": strings.Replace(mcpRichSnapshotV5, `"icon": "📝"`, `"icon": "12345678901234567"`, 1),
		"v5 note priority null":          strings.Replace(mcpRichSnapshotV5, `"status": "confirmed"`, `"priority": null, "status": "confirmed"`, 1),
		"v5 noteAssets null":             strings.Replace(mcpRichSnapshotV5, `"notes": [`, `"noteAssets": null, "notes": [`, 1),
		"v5 duplicate pfId":              strings.Replace(mcpRichSnapshotV5, `"pfId": "tbl-orders"`, `"pfId": "root-page"`, 1),
		"v5 raw prop expression":         strings.Replace(mcpRichSnapshotV5, `"props": { "title": "审计看板" }`, `"props": { "title": { "$kind": "raw", "code": "window.x" } }`, 1),
		"v5 navigate to unpublished page": strings.Replace(
			mcpRichSnapshotV5,
			`{ "name": "navigate", "args": ["audit-page"] }`,
			`{ "name": "navigate", "args": ["unpublished-ghost-page"] }`,
			1,
		),
		"v5 navigate non-string target": strings.Replace(
			mcpRichSnapshotV5,
			`{ "name": "navigate", "args": ["audit-page"] }`,
			`{ "name": "navigate", "args": [123] }`,
			1,
		),
		"v5 navigate missing args": strings.Replace(
			mcpRichSnapshotV5,
			`{ "name": "navigate", "args": ["audit-page"] }`,
			`{ "name": "navigate", "args": [] }`,
			1,
		),
		"v5 unsupported action name": strings.Replace(
			mcpRichSnapshotV5,
			`{ "name": "toast", "args": ["已提交"] }`,
			`{ "name": "evalArbitraryJs", "args": ["alert(1)"] }`,
			1,
		),
		"v5 malformed actions calls": strings.Replace(
			mcpRichSnapshotV5,
			`"calls": [{ "name": "updateRow", "args": [{ "status": "approved" }] }]`,
			`"calls": "not-an-array"`,
			1,
		),
	}
	for name, rawCase := range invalidViewerCases {
		if _, err := ValidateSnapshot(json.RawMessage(rawCase)); err == nil {
			t.Fatalf("%s: expected ValidateSnapshot to reject viewer-incompatible snapshot", name)
		}
	}

	// Navigating to a published sitemap doc entry (matching publishedMenuIndex in viewer) must be accepted
	withDocEntry := strings.Replace(
		mcpRichSnapshotV5,
		`{ "id": "node-audit", "title": "审计看板", "type": "page", "deprecated": false, "pageId": "audit-page" }`,
		`{ "id": "node-audit", "title": "审计看板", "type": "page", "deprecated": false, "pageId": "audit-page" }, { "id": "node-doc", "title": "规范文档", "type": "doc", "deprecated": false, "pageId": "doc-spec" }`,
		1,
	)
	withDocNav := strings.Replace(
		withDocEntry,
		`{ "name": "navigate", "args": ["audit-page"] }`,
		`{ "name": "navigate", "args": ["doc-spec"] }`,
		1,
	)
	if _, err := ValidateSnapshot(json.RawMessage(withDocNav)); err != nil {
		t.Fatalf("expected navigate to sitemap doc entry to pass validation, got: %v", err)
	}
}

func TestMapSqlTypePostgresPreservesNativeTypes(t *testing.T) {
	preserved := []string{
		"INTERVAL",
		"INTERVAL DAY TO SECOND",
		"INT8",
		"INT2",
		"INT4",
		"INT4RANGE",
		"INT8RANGE",
		"FLOAT8",
		"FLOAT4",
		"INT[]",
		"INTEGER[]",
		"BIGINT[]",
		"TEXT[]",
		"TIMESTAMP WITHOUT TIME ZONE",
		"TIMESTAMPTZ",
		"UUID",
		"NUMERIC(12, 2)",
	}
	for _, rawType := range preserved {
		if got := mapSqlType(rawType, "postgres"); got != rawType {
			t.Fatalf("mapSqlType(%q, postgres) = %q, want %q unchanged", rawType, got, rawType)
		}
	}
	mapped := map[string]string{
		"TINYINT(1)":          "BOOLEAN",
		"TINYINT(1) UNSIGNED": "BOOLEAN",
		"INT(11)":             "INTEGER",
		"INT(10) UNSIGNED":    "BIGINT",
		"INTEGER UNSIGNED":    "BIGINT",
		"SMALLINT UNSIGNED":   "INTEGER",
		"TINYINT UNSIGNED":    "SMALLINT",
		"MEDIUMINT":           "INTEGER",
		"DATETIME":            "TIMESTAMPTZ",
		"DATETIME(6)":         "TIMESTAMPTZ(6)",
		"TIMESTAMP":           "TIMESTAMPTZ",
		"DOUBLE(10, 2)":       "DOUBLE PRECISION",
		"FLOAT(7, 4)":         "REAL",
		"LONGBLOB":            "BYTEA",
		"VARBINARY(64)":       "BYTEA",
		"JSON":                "JSONB",
		"ENUM('a','b')":       "VARCHAR(64)",
	}
	for rawType, want := range mapped {
		if got := mapSqlType(rawType, "postgres"); got != want {
			t.Fatalf("mapSqlType(%q, postgres) = %q, want %q", rawType, got, want)
		}
	}
}

func TestMcpSharedPostgresColumnTypes(t *testing.T) {
	raw, err := os.ReadFile("testdata/postgres-column-types.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases map[string]string
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for source, target := range cases {
		if got := mapSqlType(source, "postgres"); got != target {
			t.Errorf("%s mapped to %s, want %s", source, got, target)
		}
		if got := mapSqlType(source, "mysql"); got != source {
			t.Errorf("MySQL declaration changed from %s to %s", source, got)
		}
	}
}

func TestDecodeBoundedBatchStopsBeforeAllocatingUnboundedArray(t *testing.T) {
	var parts []string
	for i := 0; i < 500; i++ {
		parts = append(parts, fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"ping"}`, i))
	}
	raw := []byte("[" + strings.Join(parts, ",") + "]")
	items, err := decodeBoundedBatch(raw, maxMcpBatchSize)
	if err != errMcpBatchTooLarge || items != nil {
		t.Fatalf("expected errMcpBatchTooLarge without returning oversized slice, got err=%v len=%d", err, len(items))
	}
}

func TestRemoteStreamableHttpMcpEndpoint(t *testing.T) {
	pwHash, err := HashPassword("teamSecret88")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	now := time.Now().UTC()
	expired := now.Add(-time.Hour)

	// Build a large snapshot (> 1.5 MiB text) to verify the 4 MiB cumulative batch response budget
	hugeText := strings.Repeat("大型工程压力测试内容ABCD1234", 75000) // ~1.8 MiB UTF-8
	oversizedSnap := strings.Replace(mcpLegacySnapshotV3, `"description": ""`, `"description": "`+hugeText+`"`, 1)

	store := &memoryStore{
		items: map[string]Publication{
			"pub-open-1234567890abcd": {
				ID:        "pub-open-1234567890abcd",
				ProjectID: "proj-mcp-go",
				Title:     "库存与订单协同原型",
				Snapshot:  json.RawMessage(mcpRichSnapshotV5),
				Version:   2,
				CreatedAt: now,
				UpdatedAt: now,
			},
			"pub-v3-legacy-12345678": {
				ID:        "pub-v3-legacy-12345678",
				ProjectID: "proj-legacy-v3",
				Title:     "旧版V3原型",
				Snapshot:  json.RawMessage(mcpLegacySnapshotV3),
				Version:   1,
				CreatedAt: now,
				UpdatedAt: now,
			},
			"pub-huge-1234567890abcd": {
				ID:        "pub-huge-1234567890abcd",
				ProjectID: "proj-legacy-v3",
				Title:     "超大快照原型",
				Snapshot:  json.RawMessage(oversizedSnap),
				Version:   1,
				CreatedAt: now,
				UpdatedAt: now,
			},
			"pub-lock-1234567890abcd": {
				ID:                "pub-lock-1234567890abcd",
				ProjectID:         "proj-mcp-go",
				Title:             "库存与订单协同原型",
				Snapshot:          json.RawMessage(mcpRichSnapshotV5),
				Version:           4,
				PasswordHash:      pwHash,
				PasswordProtected: true,
				CreatedAt:         now,
				UpdatedAt:         now,
			},
			"pub-dead-1234567890abcd": {
				ID:        "pub-dead-1234567890abcd",
				ProjectID: "proj-mcp-go",
				Title:     "已过期分享",
				Snapshot:  json.RawMessage(mcpRichSnapshotV5),
				Version:   1,
				ExpiresAt: &expired,
				CreatedAt: now,
				UpdatedAt: now,
			},
		},
	}

	router := Handler(store, Options{PublicOrigin: "https://proto.example.com"})

	// 1. GET returns 405 Method Not Allowed
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/mcp/pub-open-1234567890abcd", nil)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 on GET, got %d", getRec.Code)
	}

	// 2. Notification returns 202 Accepted
	notifReq := httptest.NewRequest(http.MethodPost, "/api/v1/mcp/pub-open-1234567890abcd", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	notifReq.Header.Set("Content-Type", "application/json")
	notifRec := httptest.NewRecorder()
	router.ServeHTTP(notifRec, notifReq)
	if notifRec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 on notification, got %d", notifRec.Code)
	}

	rpcCall := func(shareID string, headers map[string]string, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/mcp/"+shareID, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	parseToolMap := func(rec *httptest.ResponseRecorder) map[string]any {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var env struct {
			Result struct {
				IsError bool `json:"isError"`
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
			} `json:"result"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || env.Result.IsError || len(env.Result.Content) == 0 {
			t.Fatalf("unexpected tool rpc response: %s", rec.Body.String())
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(env.Result.Content[0].Text), &out); err != nil {
			t.Fatalf("invalid tool JSON text: %v\n%s", err, env.Result.Content[0].Text)
		}
		return out
	}

	// 3. [P1 + P2] V5 DDL preserves single-column UNIQUE, composite CONSTRAINT UNIQUE, and PostgreSQL BOOLEAN DEFAULT TRUE/FALSE
	dbOut := parseToolMap(rpcCall("pub-open-1234567890abcd", nil, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"protoflow_get_database_schema","arguments":{"dialect":"postgres"}}}`))
	if dbOut["uniqueConstraintsComplete"] != true {
		t.Fatalf("expected uniqueConstraintsComplete=true for V5 share, got %v", dbOut["uniqueConstraintsComplete"])
	}
	ddl, _ := dbOut["ddl"].(string)
	for _, snippet := range []string{
		`"order_code" VARCHAR(64) NOT NULL UNIQUE`,
		`CONSTRAINT "uq_supplier_order_code" UNIQUE ("supplier_id", "order_code")`,
		`"status" VARCHAR(32) NOT NULL DEFAULT 'pending'`,
		`"trace_token" VARCHAR(64) NOT NULL DEFAULT gen_random_uuid()`,
		`"is_urgent" BOOLEAN NOT NULL DEFAULT TRUE`,
		`"is_archived" BOOLEAN NOT NULL DEFAULT FALSE`,
		`-- 待修复的外键引用：t_audit_log.broken_ref：外键引用 t_org(nonexistent_col) 无法解析`,
		`-- 待修复的外键引用：t_audit_log.region_ref：外键引用 t_org(region_code) 的目标列缺少单列主键或 UNIQUE 约束，已跳过外键 DDL`,
		`-- 待修复的外键引用：t_audit_log.tenant_ref：外键引用 t_tenant_member(tenant_id) 的目标列缺少单列主键或 UNIQUE 约束，已跳过外键 DDL`,
	} {
		if !strings.Contains(ddl, snippet) {
			t.Fatalf("expected DDL to contain %q, got:\n%s", snippet, ddl)
		}
	}
	if strings.Contains(ddl, `"nonexistent_col"`) ||
		strings.Contains(ddl, `REFERENCES "t_org" ("region_code")`) ||
		strings.Contains(ddl, `REFERENCES "t_tenant_member" ("tenant_id")`) {
		t.Fatalf("DDL emitted invalid ALTER TABLE referencing missing, non-unique, or composite-PK column:\n%s", ddl)
	}

	// 4. [P2] Filtering by child table t_orders pulls transitive parent tables (t_org, t_supplier) into DDL and excludes unrelated t_audit_log FKs
	filteredDb := parseToolMap(rpcCall("pub-open-1234567890abcd", nil, `{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"protoflow_get_database_schema","arguments":{"tableNames":["t_orders"],"dialect":"postgres"}}}`))
	filteredDdl, _ := filteredDb["ddl"].(string)
	if !strings.Contains(filteredDdl, `CREATE TABLE IF NOT EXISTS "t_org"`) ||
		!strings.Contains(filteredDdl, `CREATE TABLE IF NOT EXISTS "t_supplier"`) ||
		!strings.Contains(filteredDdl, `CREATE TABLE IF NOT EXISTS "t_orders"`) {
		t.Fatalf("filtered DDL missing transitive parent tables:\n%s", filteredDdl)
	}
	if strings.Contains(filteredDdl, `"t_audit_log"`) {
		t.Fatalf("filtered DDL leaked unrelated table t_audit_log:\n%s", filteredDdl)
	}
	scopedFKs, _ := filteredDb["foreignKeys"].([]any)
	if len(scopedFKs) != 2 {
		t.Fatalf("expected 2 scoped FKs (t_supplier->t_org and t_orders->t_supplier), got %d: %+v", len(scopedFKs), scopedFKs)
	}

	// 5. [P1] Legacy V3 share explicitly sets uniqueConstraintsComplete=false and emits DDL warning banner
	legacyDb := parseToolMap(rpcCall("pub-v3-legacy-12345678", nil, `{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"protoflow_get_database_schema","arguments":{"dialect":"postgres"}}}`))
	if legacyDb["uniqueConstraintsComplete"] != false {
		t.Fatalf("expected uniqueConstraintsComplete=false on V3 share")
	}
	legacyDdl, _ := legacyDb["ddl"].(string)
	if !strings.HasPrefix(legacyDdl, "-- [警告]") {
		t.Fatalf("expected legacy DDL warning header, got:\n%s", legacyDdl)
	}
	if _, hasWarn := legacyDb["warnings"]; !hasWarn {
		t.Fatalf("expected warnings field on legacy V3 schema response")
	}

	// 6. [P2] Nested rowActions onClick prints executable TSX arrow callbacks without $kind JSON leakage
	ordersSpec := parseToolMap(rpcCall("pub-open-1234567890abcd", nil, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"protoflow_get_page_spec","arguments":{"pageId":"orders-page"}}}`))
	tsx, _ := ordersSpec["pageSourceTsx"].(string)
	if strings.Contains(tsx, "$kind") {
		t.Fatalf("pageSourceTsx leaked raw $kind JSON:\n%s", tsx)
	}
	if !strings.Contains(tsx, "onClick: () => updateRow({ status: 'approved' })") ||
		!strings.Contains(tsx, "onClick: () => { toast('已提交'); navigate('audit-page'); }") {
		t.Fatalf("pageSourceTsx did not format nested rowActions callbacks properly:\n%s", tsx)
	}

	// 7. [P2] Explicit sharedByMenus binding on audit-page (without a Table component) is included in tableBindings and module checklist
	auditSpec := parseToolMap(rpcCall("pub-open-1234567890abcd", nil, `{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"protoflow_get_page_spec","arguments":{"pageId":"audit-page"}}}`))
	auditBindings, _ := auditSpec["tableBindings"].([]any)
	if len(auditBindings) != 1 {
		t.Fatalf("expected 1 explicit sharedByMenus tableBinding on audit-page, got %+v", auditBindings)
	}
	auditCheck := parseToolMap(rpcCall("pub-open-1234567890abcd", nil, `{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"protoflow_get_implementation_checklist","arguments":{"moduleKeyword":"审计看板"}}}`))
	dbTasks, _ := auditCheck["databaseTasks"].([]any)
	if len(dbTasks) != 1 {
		t.Fatalf("expected t_audit_log in module checklist for 审计看板, got %+v", dbTasks)
	}

	// 8. [P1 + P2] Request body > 64 KiB rejected (413), batch > 16 rejected (-32600), and cumulative response (including error frames) strictly <= 4 MiB
	tooLargeReqBody := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"protoflow_search_spec","arguments":{"query":"` + strings.Repeat("x", 70000) + `"}}}`
	if rpcCall("pub-open-1234567890abcd", nil, tooLargeReqBody).Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 on >64 KiB MCP request body")
	}

	var overBatch []string
	for i := 1; i <= 17; i++ {
		overBatch = append(overBatch, fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"ping"}`, i))
	}
	overBatchRec := rpcCall("pub-open-1234567890abcd", nil, "["+strings.Join(overBatch, ",")+"]")
	if !strings.Contains(overBatchRec.Body.String(), `"code":-32600`) {
		t.Fatalf("expected -32600 on >16 batch items, got: %s", overBatchRec.Body.String())
	}

	assertBatchPreservesRequestIDs := func(label string, rec *httptest.ResponseRecorder, expectedCount int) {
		t.Helper()
		if rec.Code != http.StatusOK || rec.Body.Len() > maxMcpResponseBytes {
			t.Fatalf("%s: expected 200 <= %d bytes, got code=%d len=%d", label, maxMcpResponseBytes, rec.Code, rec.Body.Len())
		}
		var batchResps []jsonRpcResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &batchResps); err != nil {
			t.Fatalf("%s: expected JSON-RPC batch response array preserving request IDs, got non-array: %v\nbody=%s", label, err, rec.Body.String()[:min(300, rec.Body.Len())])
		}
		if len(batchResps) != expectedCount {
			t.Fatalf("%s: expected %d batch responses, got %d", label, expectedCount, len(batchResps))
		}
		sawBudgetErr := false
		for idx, item := range batchResps {
			wantID := strconv.Itoa(idx + 1)
			if string(item.ID) != wantID {
				t.Fatalf("%s: response[%d].id = %s, want %s", label, idx, string(item.ID), wantID)
			}
			if item.Error != nil && item.Error.Code == -32005 {
				sawBudgetErr = true
			}
		}
		if !sawBudgetErr {
			t.Fatalf("%s: expected at least one -32005 budget limit error in batch", label)
		}
	}

	var heavyBatch []string
	for i := 1; i <= 16; i++ {
		heavyBatch = append(heavyBatch, fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":"protoflow_get_database_schema","arguments":{}}}`, i))
	}
	heavyRec := rpcCall("pub-huge-1234567890abcd", nil, "["+strings.Join(heavyBatch, ",")+"]")
	assertBatchPreservesRequestIDs("heavyBatch", heavyRec, 16)

	// Edge case: item 1 alone leaves < 60 bytes before 4 MiB, so 15 trailing error frames cannot fit after item 1's full payload.
	// Server MUST reserve space for trailing error frames and return a 16-element array preserving IDs 1..16 within 4 MiB!
	probeSingle := rpcCall("pub-v3-legacy-12345678", nil, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"protoflow_get_database_schema","arguments":{}}}`)
	padNeeded := (maxMcpResponseBytes - 80) - probeSingle.Body.Len()
	if padNeeded > 0 {
		nearSnap := strings.Replace(mcpLegacySnapshotV3, `"description": ""`, `"description": "`+strings.Repeat("Z", padNeeded/2)+`"`, 1)
		store.items["pub-near-limit-123456789"] = Publication{
			ID: "pub-near-limit-123456789", ProjectID: "proj-legacy-v3", Title: "临界快照",
			Snapshot: json.RawMessage(nearSnap), Version: 1, CreatedAt: now, UpdatedAt: now,
		}
		firstTry := rpcCall("pub-near-limit-123456789", nil, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"protoflow_get_database_schema","arguments":{}}}`)
		delta := (maxMcpResponseBytes - 60) - firstTry.Body.Len()
		if delta > 0 {
			exactSnap := strings.Replace(mcpLegacySnapshotV3, `"description": ""`, `"description": "`+strings.Repeat("Z", padNeeded/2+delta/2)+`"`, 1)
			store.items["pub-near-limit-123456789"] = Publication{
				ID: "pub-near-limit-123456789", ProjectID: "proj-legacy-v3", Title: "临界快照",
				Snapshot: json.RawMessage(exactSnap), Version: 1, CreatedAt: now, UpdatedAt: now,
			}
		}
		nearRec := rpcCall("pub-near-limit-123456789", nil, "["+strings.Join(heavyBatch, ",")+"]")
		assertBatchPreservesRequestIDs("nearBoundaryBatch", nearRec, 16)
	}

	// 9. Password-protected (including padded whitespace & Unicode via X-Protoflow-Password-Base64) & expired share checks
	if rpcCall("pub-lock-1234567890abcd", nil, `{"jsonrpc":"2.0","id":8,"method":"ping"}`).Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without password")
	}
	if rpcCall("pub-lock-1234567890abcd", map[string]string{"X-Protoflow-Password": "teamSecret88"}, `{"jsonrpc":"2.0","id":10,"method":"ping"}`).Code != http.StatusOK {
		t.Fatalf("expected 200 with valid X-Protoflow-Password")
	}
	paddedPw := "  paddedPass99  "
	paddedHash, err := HashPassword(paddedPw)
	if err != nil {
		t.Fatal(err)
	}
	unicodePw := "密码测试888"
	unicodeHash, err := HashPassword(unicodePw)
	if err != nil {
		t.Fatal(err)
	}
	store.items["pub-lock-padded-12345678"] = Publication{
		ID: "pub-lock-padded-12345678", ProjectID: "proj-mcp-go", Title: "空格密码分享",
		Snapshot: json.RawMessage(mcpRichSnapshotV5), Version: 1, PasswordHash: paddedHash, PasswordProtected: true, CreatedAt: now, UpdatedAt: now,
	}
	store.items["pub-lock-unicode-1234567"] = Publication{
		ID: "pub-lock-unicode-1234567", ProjectID: "proj-mcp-go", Title: "中文密码分享",
		Snapshot: json.RawMessage(mcpRichSnapshotV5), Version: 1, PasswordHash: unicodeHash, PasswordProtected: true, CreatedAt: now, UpdatedAt: now,
	}
	if rpcCall("pub-lock-padded-12345678", map[string]string{"X-Protoflow-Password": "paddedPass99"}, `{"jsonrpc":"2.0","id":11,"method":"ping"}`).Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when trimmed password does not match padded share password")
	}
	if rpcCall("pub-lock-padded-12345678", map[string]string{"X-Protoflow-Password-Base64": base64.StdEncoding.EncodeToString([]byte(paddedPw))}, `{"jsonrpc":"2.0","id":11,"method":"ping"}`).Code != http.StatusOK {
		t.Fatalf("expected 200 with exact padded password via X-Protoflow-Password-Base64")
	}
	if rpcCall("pub-lock-unicode-1234567", map[string]string{"X-Protoflow-Password-Base64": base64.StdEncoding.EncodeToString([]byte(unicodePw))}, `{"jsonrpc":"2.0","id":11,"method":"ping"}`).Code != http.StatusOK {
		t.Fatalf("expected 200 with exact Unicode password via X-Protoflow-Password-Base64")
	}
	if rpcCall("pub-dead-1234567890abcd", nil, `{"jsonrpc":"2.0","id":12,"method":"ping"}`).Code != http.StatusGone {
		t.Fatalf("expected 410 on expired share")
	}

	// 10. [P2] JSON-RPC request IDs must be validated & matched by decoded value regardless of \uXXXX escaping
	asciiEscape := func(s string) string {
		var b strings.Builder
		for _, r := range s {
			fmt.Fprintf(&b, `\u%04x`, r)
		}
		return b.String()
	}
	logicalID := "req-协同追踪-1234567890abcdefghij"
	escapedID := asciiEscape(logicalID) // > 170 raw JSON bytes, while decoded string is well under 256 UTF-8 bytes
	if len(escapedID)+2 <= 128 {
		t.Fatalf("expected escaped JSON string literal to exceed 128 raw bytes, got %d", len(escapedID)+2)
	}
	rawIDRec := rpcCall("pub-open-1234567890abcd", nil, fmt.Sprintf(`{"jsonrpc":"2.0","id":%q,"method":"ping"}`, logicalID))
	escIDRec := rpcCall("pub-open-1234567890abcd", nil, fmt.Sprintf(`{"jsonrpc":"2.0","id":"%s","method":"ping"}`, escapedID))
	var rawResp, escResp struct {
		ID    string        `json:"id"`
		Error *jsonRpcError `json:"error"`
	}
	if err := json.Unmarshal(rawIDRec.Body.Bytes(), &rawResp); err != nil || rawResp.Error != nil || rawResp.ID != logicalID {
		t.Fatalf("raw ID request failed: %s", rawIDRec.Body.String())
	}
	if err := json.Unmarshal(escIDRec.Body.Bytes(), &escResp); err != nil || escResp.Error != nil || escResp.ID != logicalID {
		t.Fatalf("\\uXXXX-escaped ID request failed or changed ID value: %s", escIDRec.Body.String())
	}

	batchEscRec := rpcCall(
		"pub-open-1234567890abcd",
		nil,
		fmt.Sprintf(`[{"jsonrpc":"2.0","id":"%s","method":"ping"},{"jsonrpc":"2.0","id":%q,"method":"ping"}]`, escapedID, logicalID),
	)
	var batchEscResps []struct {
		ID    string        `json:"id"`
		Error *jsonRpcError `json:"error"`
	}
	if err := json.Unmarshal(batchEscRec.Body.Bytes(), &batchEscResps); err != nil || len(batchEscResps) != 2 ||
		batchEscResps[0].Error != nil || batchEscResps[0].ID != logicalID ||
		batchEscResps[1].Error != nil || batchEscResps[1].ID != logicalID {
		t.Fatalf("batch \\uXXXX-escaped IDs failed: %s", batchEscRec.Body.String())
	}

	numericIDs := []string{"1" + strings.Repeat("0", 64), "1" + strings.Repeat("0", 63) + "1"}
	var requests []string
	for _, id := range numericIDs {
		requests = append(requests, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"method":"ping"}`, id))
	}
	longBatch := rpcCall("pub-open-1234567890abcd", nil, "["+strings.Join(requests, ",")+"]")
	var responses []jsonRpcResponse
	if err := json.Unmarshal(longBatch.Body.Bytes(), &responses); err != nil || len(responses) != len(numericIDs) {
		t.Fatalf("invalid ping batch response: %s", longBatch.Body.String())
	}
	for i, response := range responses {
		if response.Error != nil || string(response.ID) != numericIDs[i] {
			t.Errorf("response %d: got id %s, want %s (error %v)", i, response.ID, numericIDs[i], response.Error)
		}
	}

	tooLongDecodedID := strings.Repeat("a", maxMcpRpcIDBytes+1)
	tooLongRec := rpcCall("pub-open-1234567890abcd", nil, fmt.Sprintf(`{"jsonrpc":"2.0","id":%q,"method":"ping"}`, tooLongDecodedID))
	if !strings.Contains(tooLongRec.Body.String(), `"code":-32600`) {
		t.Fatalf("expected decoded ID > %d bytes to return -32600, got: %s", maxMcpRpcIDBytes, tooLongRec.Body.String())
	}
	for _, badID := range []string{`{"nested":1}`, `[1,2]`, `true`} {
		badRec := rpcCall("pub-open-1234567890abcd", nil, fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"method":"ping"}`, badID))
		if !strings.Contains(badRec.Body.String(), `"code":-32600`) {
			t.Fatalf("expected invalid non-scalar ID %s to return -32600, got: %s", badID, badRec.Body.String())
		}
	}
}

func TestMcpPostgresNumericAndTemporalDDL(t *testing.T) {
	dsn := os.Getenv("PUBLISH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PUBLISH_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	schema := pgx.Identifier{"mcp_types_" + strings.ToLower(NewID())}.Sanitize()
	if _, err := tx.Exec(ctx, "CREATE SCHEMA "+schema+"; SET LOCAL search_path TO "+schema); err != nil {
		t.Fatal(err)
	}

	table := mcpTable{TableName: "measurements", Columns: []mcpColumn{
		{Name: "serial_no", DataType: "BIGINT UNSIGNED"},
		{Name: "counter", DataType: "INT UNSIGNED ZEROFILL"},
		{Name: "reading", DataType: "FLOAT(53)"},
		{Name: "recorded", DataType: "DATETIME(0)"},
		{Name: "updated", DataType: "TIMESTAMP(3)"},
	}}
	if _, err := tx.Exec(ctx, generateMcpDdl([]mcpTable{table}, nil, nil, "postgres")); err != nil {
		t.Fatal(err)
	}
	var exact bool
	err = tx.QueryRow(ctx, `INSERT INTO measurements VALUES
		(18446744073709551615, 4294967295, 16777217, '2026-01-01 10:00:00.123456+00', '2026-01-01 10:00:00.123456+00')
		RETURNING serial_no = 18446744073709551615 AND counter = 4294967295 AND reading::numeric = 16777217
		AND EXTRACT(MICROSECONDS FROM recorded) = 0 AND EXTRACT(MICROSECONDS FROM updated) = 123000`).Scan(&exact)
	if err != nil || !exact {
		t.Fatalf("generated DDL changed stored values: exact=%v, err=%v", exact, err)
	}
	for _, sql := range []string{"UPDATE measurements SET serial_no = 18446744073709551616", "UPDATE measurements SET counter = -1"} {
		probe, err := tx.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = probe.Exec(ctx, sql)
		if dbErr, ok := err.(*pgconn.PgError); !ok || dbErr.Code != "23514" {
			t.Fatalf("expected unsigned range check violation for %s, got %v", sql, err)
		}
		if err := probe.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPostgresMigrationAcceptsFormat5Snapshot(t *testing.T) {
	dsn := os.Getenv("PUBLISH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PUBLISH_TEST_DATABASE_URL for PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("invalid test database")
	}
	defer pool.Close()
	schema := "mcp_v5_migration_" + strings.ToLower(NewID())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = pool.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	isolated, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer isolated.Close()
	if _, err = isolated.Exec(ctx, migrations.All); err != nil {
		t.Fatalf("migrations.All failed: %v", err)
	}
	pubID := NewID()
	ownerID := NewID()
	if _, err = isolated.Exec(ctx, `INSERT INTO publishers(id,name,token_hash) VALUES($1,'v5-test',$2)`, ownerID, TokenHash(ownerID)); err != nil {
		t.Fatal(err)
	}
	pgStore := Postgres{Pool: isolated}
	created, err := pgStore.Create(ctx, Publication{
		ID:          pubID,
		PublisherID: ownerID,
		ProjectID:   "proj-mcp-go",
		Title:       "库存与订单协同原型",
		Snapshot:    json.RawMessage(mcpRichSnapshotV5),
	})
	if err != nil {
		t.Fatalf("expected PostgreSQL publications_snapshot_check to accept formatVersion=5, got: %v", err)
	}
	if created.Version != 1 {
		t.Fatalf("unexpected version %d", created.Version)
	}
}
