package publish

import (
	"encoding/json"
	"strings"
	"testing"
)

const pngData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

var projectNotesFixture = string(notesSnapshot(
	`[{"noteId":"note-1","title":"需求背景","icon":"📝","status":"confirmed","priority":"P0","meetingDate":"2026-11-04","updatedAt":"2026-11-04T00:00:00Z","html":"<p>说明</p><img src=\"pf-asset:img-abc123\">","pageIds":["page-A"]}]`,
	`{"img-abc123":{"mime":"image/png","data":"`+pngData+`"}}`,
))

func notesSnapshot(notes, assets string) json.RawMessage {
	v4 := strings.Replace(sitemapFixture, `"formatVersion":3`, `"formatVersion":4`, 1)
	return json.RawMessage(strings.TrimSuffix(v4, "}") + `,"notes":` + notes + `,"noteAssets":` + assets + `}`)
}

func TestFormat4AcceptsSharedNotesAndAssets(t *testing.T) {
	notes := `[{"noteId":"note-1","title":"需求背景","icon":"📝","status":"confirmed","priority":"P0","meetingDate":"2026-11-04","updatedAt":"2026-11-04T00:00:00Z","html":"<p>说明</p><img src=\"pf-asset:img-abc123\">","pageIds":["page-A"]}]`
	assets := `{"img-abc123":{"mime":"image/png","data":"` + pngData + `"}}`
	s, err := ValidateSnapshot(notesSnapshot(notes, assets))
	if err != nil {
		t.Fatalf("format 4 with notes should be accepted: %v", err)
	}
	if len(s.Notes) != 1 || len(s.NoteAssets) != 1 {
		t.Fatalf("notes were not decoded: %+v", s.Notes)
	}
}

func TestFormat4RejectsInvalidNotes(t *testing.T) {
	valid := `{"noteId":"note-1","title":"需求背景","icon":"📝","status":"confirmed","updatedAt":"2026-11-04","html":"<p>x</p>","pageIds":["page-A"]}`
	cases := map[string]json.RawMessage{
		"missing notes":      json.RawMessage(strings.Replace(sitemapFixture, `"formatVersion":3`, `"formatVersion":4`, 1)),
		"unknown page":       notesSnapshot(`[`+strings.Replace(valid, `"page-A"`, `"page-X"`, 1)+`]`, `{}`),
		"bad status":         notesSnapshot(`[`+strings.Replace(valid, `"confirmed"`, `"done"`, 1)+`]`, `{}`),
		"bad priority":       notesSnapshot(`[`+strings.Replace(valid, `"status"`, `"priority":"P9","status"`, 1)+`]`, `{}`),
		"duplicate note":     notesSnapshot(`[`+valid+`,`+valid+`]`, `{}`),
		"unknown note field": notesSnapshot(`[`+strings.Replace(valid, `"icon"`, `"stakeholder":"王总","icon"`, 1)+`]`, `{}`),
		"bad asset id":       notesSnapshot(`[`+valid+`]`, `{"../x":{"mime":"image/png","data":"`+pngData+`"}}`),
		"bad asset mime":     notesSnapshot(`[`+valid+`]`, `{"img-abc123":{"mime":"text/html","data":"`+pngData+`"}}`),
		"bad asset data":     notesSnapshot(`[`+valid+`]`, `{"img-abc123":{"mime":"image/png","data":"%%%"}}`),
		"notes on format 3":  json.RawMessage(strings.TrimSuffix(sitemapFixture, "}") + `,"notes":[]}`),
	}
	for name, raw := range cases {
		if _, err := ValidateSnapshot(raw); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}
