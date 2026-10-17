import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLimbusTeamBoxes,
  parseNikkeTeams,
  parseUpdated,
  parseWuwaRatings,
  parseWuwaTeams,
  parseZzzRatings,
  wuwaTierLine,
  zzzTierLine,
} from "../../mcp-server/scripts/cited-gap-parse.mjs";

const wuwa = `
<p>Last updated: <span>05/October/2026</span></p>
<h5><span class="role dps"> DPS<span class="role-dupes"> [S0]</span></span></h5>
<div class="detailed-ratings ww"><div class="rating-box-container"><span><div class="rating-box ww T3">T3</div></span><p>Tower of Adversity</p></div><div class="rating-box-container"><span><div class="rating-box ww T4">T4</div></span><p>Whimpering Wastes</p></div></div></div>
<h6 class="text-lg value-tier-heading">Value Tier List</h6>
<h5><span class="role dps"> DPS<span class="role-dupes"> [S0]</span></span></h5>
<div class="detailed-ratings ww"><div class="rating-box-container"><span><div class="rating-box ww T2">T2</div></span><p>Tower of Adversity (Value)</p></div></div></div>
<div class="team-header"><p>Best Team</p></div>
<div class="team-row"><div class="column"><div class="big"><a href="/wuthering-waves/characters/camellya">Camellya</a></div><div class="small"></div></div><div class="column middle"><div class="big"><a href="/wuthering-waves/characters/lynae">Lynae</a></div><div class="small"><a href="/wuthering-waves/characters/roccia">Roccia</a><a href="/wuthering-waves/characters/sanhua">Sanhua</a></div></div><div class="column"><div class="big"><a href="/wuthering-waves/characters/mornye">Mornye</a></div><div class="small"><a href="/wuthering-waves/characters/verina">Verina</a></div></div></div>
<div class="team-header"><p>F2P</p></div>
<div class="team-row"><div class="column"><div class="big"><a href="/wuthering-waves/characters/danjin">Danjin</a></div><div class="small"></div></div><div class="column"><div class="big"><a href="/wuthering-waves/characters/sanhua">Sanhua</a></div><div class="small"></div></div><div class="column"><div class="big"><a href="/wuthering-waves/characters/baizhi">Baizhi</a></div><div class="small"></div></div></div>
`;

test("wuwa ratings keep the main modes and ignore the value block when main exists", () => {
  assert.equal(parseUpdated(wuwa), "2026-10-05");
  const parsed = parseWuwaRatings(`<p>Value Tier List</p>${wuwa}`);
  assert.equal(parsed.value, false);
  assert.equal(wuwaTierLine(parsed), "Prydwen DPS [S0]：Tower of Adversity T3 / Whimpering Wastes T4");
});

test("wuwa teams use one link per slot, or the large icon when substitutes are listed", () => {
  const teams = parseWuwaTeams(wuwa);
  assert.equal(teams.length, 2);
  assert.deepEqual(teams[0], {
    header: "Best Team",
    slugs: ["camellya", "lynae", "mornye"],
    primaryOnly: true,
  });
  assert.deepEqual(teams[1], {
    header: "F2P",
    slugs: ["danjin", "sanhua", "baizhi"],
    primaryOnly: false,
  });
});

test("zzz ratings copy the printed endgame label", () => {
  const html = `<p>Last updated: <span>10/October/2026</span></p><h5>Crit DPS</h5><div class="detailed-ratings reverse"><div class="rating-box-container"><span><div class="rating-box hsr rating-hsr-8">T1.5</div></span><p>Endgame Modes</p></div></div></div><h5 class="text-xl">Pros</h5>`;
  const rows = parseZzzRatings(html);
  assert.equal(zzzTierLine(rows), "Prydwen Crit DPS：Endgame Modes T1.5");
});

test("dates survive a comment and a strong tag, and a limbus box keeps its identity links", () => {
  assert.equal(parseUpdated("Last updated:<!-- --> <strong>22/May/2026</strong>"), "2026-05-22");
  const html = `<div class="box limbus-team"><p class="skill-name">Bleed</p>
<a href="/limbus-company/identities/a"></a>
<a href="/limbus-company/identities/b"></a>
<a href="/limbus-company/identities/c"></a>
<a href="/limbus-company/identities/d"></a>
<a href="/limbus-company/identities/e"></a>
<a href="/limbus-company/identities/a"></a>
</div>`;
  assert.deepEqual(parseLimbusTeamBoxes(html), [{ title: "Bleed", slugs: ["a", "b", "c", "d", "e"] }]);
});

test("nikke teams drop a box that still has an open placeholder", () => {
  const html = `
<div class="box nikke-team"><div class="team-header"><p class="skill-name">Full boss</p><p class="skill-type">Mode: <strong>Bossing</strong> || Element: <strong class="Fire">Fire</strong></p></div>
<a href="/nikke/characters/liter"></a><a href="/nikke/characters/crown"></a><a href="/nikke/characters/naga"></a><a href="/nikke/characters/red-hood"></a><a href="/nikke/characters/modernia"></a>
</div>
<div class="box nikke-team"><p class="skill-name">Flex</p><p class="skill-type">Mode: <strong>Bossing</strong> || Element: <strong>All</strong></p>
<a href="/nikke/characters/ade"></a><a href="/nikke/characters/sakura"></a><a href="/nikke/characters/guillotine"></a><a href="/nikke/characters/moran"></a><div class="placeholder-role">B3</div>
</div>`;
  const teams = parseNikkeTeams(html);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].title, "Full boss");
  assert.deepEqual(teams[0].slugs, ["liter", "crown", "naga", "red-hood", "modernia"]);
});
