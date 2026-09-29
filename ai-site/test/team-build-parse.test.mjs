import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptProse,
  cardsMentioned,
  matchCardByTitle,
  notesFromGuide,
  parseModeTable,
} from "../../mcp-server/scripts/team-build-parse.mjs";

const cards = [
  { id: "mi_la", name: "米拉", name_zh: "米拉" },
  { id: "mi_la_na", name: "米拉娜", name_zh: "米拉娜" },
  { id: "cola", name: "科拉", name_zh: "科拉" },
  { id: "ke_la_bi", name: "科拉比", name_zh: "科拉比" },
  { id: "yuha", name: "尤哈", name_zh: "尤哈" },
  { id: "shiraishi_kotoha", name: "白石琴叶", name_zh: "白石琴叶", nicknames: ["冰女"] },
  { id: "scarlet", name: "红莲", name_zh: "红莲" },
  { id: "scarlet-black", name: "红莲：暗影", name_zh: "红莲：暗影" },
];

test("longest title token wins over a shorter name inside it", () => {
  assert.equal(matchCardByTitle("米拉娜测评", cards), "mi_la_na");
  assert.equal(matchCardByTitle("科拉比测评", cards), "ke_la_bi");
  assert.equal(matchCardByTitle("琴叶测评", cards), "shiraishi_kotoha");
  assert.equal(matchCardByTitle("珠哈", cards), "yuha");
  assert.equal(matchCardByTitle("小车测评", cards), null);
});

test("mode table keeps only check marks from the strength list", () => {
  const nodes = [
    {
      type: "table",
      children: [
        {
          children: ["角色名", "主线开荒", "45层裂隙", "多巴胺", "特殊作战", "总力战", "特殊训练场"].map(
            (text) => ({ children: [{ text }] })
          ),
        },
        {
          children: ["迦露德", "√", "√", "√", "√", "×", "×"].map((text) => ({
            children: [{ text }],
          })),
        },
      ],
    },
  ];
  assert.deepEqual(parseModeTable(nodes), [
    {
      name: "迦露德",
      fit: {
        story: "√",
        rift_45: "√",
        dopamine: "√",
        spec_ops: "√",
        union: "×",
        training: "×",
      },
    },
  ]);
});

test("a longer published name hides the shorter one in the same sentence", () => {
  const hits = cardsMentioned("优先级T2 红莲：暗影", cards);
  assert.deepEqual(hits.map((hit) => hit.id), ["scarlet-black"]);
});

test("guide notes attach a priority line and skip the do-not-use banner", () => {
  const notes = notesFromGuide(
    ["爆裂阶段1：优先级T0：", "红莲：暗影", "请不要参考旧配队"],
    cards
  );
  assert.equal(notes.has("scarlet"), false);
  assert.match(notes.get("scarlet-black")[0], /优先级T0/);
  assert.equal(acceptProse("当前版本修改过大 请不要参考", { kind: "blurb" }), "");
});
