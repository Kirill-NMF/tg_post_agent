import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductionShapeFixture,
  cleanupScopeMatches,
  prepareFixtureLifecycle,
  productionShapeFixtureMarker
} from "./production_shape_format_fixture.mjs";

test("builds a private seven-segment long-form editable fixture", () => {
  const fixture = buildProductionShapeFixture({
    accountId: "7",
    now: new Date("2026-01-01T00:00:00Z")
  });
  assert.equal(fixture.telegramUserId, "7");
  assert.equal(fixture.chatId, "7");
  assert.equal(fixture.state, "draft_editing");
  assert.equal(fixture.isActive, true);
  assert.equal(fixture.posts[0].draftVersion, 1);
  assert.equal(fixture.posts[0].currentDraft.split(/\n\s*\n/u).length, 7);
  assert.ok(fixture.posts[0].currentDraft.match(/[\p{L}\p{N}]+/gu).length >= 70);
  assert.equal(fixture.messages.at(-1).text, productionShapeFixtureMarker);
});

test("cleanup scope requires exact private fixture and prior active project", () => {
  const expected = { fixtureId: "fixture", marker: productionShapeFixtureMarker, accountId: "7", priorActiveProjectId: "prior" };
  assert.equal(cleanupScopeMatches(expected, { ...expected }), true);
  assert.equal(cleanupScopeMatches(expected, { ...expected, fixtureId: "other" }), false);
  assert.equal(cleanupScopeMatches(expected, { ...expected, priorActiveProjectId: "other" }), false);
});
  assert.equal(cleanupScopeMatches({}, {}), false);

test("fixture lifecycle preserves and restores the unrelated active project", async () => {
  const events = [];
  const lifecycle = prepareFixtureLifecycle({
    accountId: "7",
    findActive: async () => ({ id: "prior", state: "done", isActive: true }),
    transaction: async (work) => work({
      suspendPrior: async (id) => events.push(["suspend", id]),
      saveFixture: async (fixture) => events.push(["save", fixture.state]),
      deleteFixture: async (id) => events.push(["delete", id]),
      restorePrior: async (id) => events.push(["restore", id])
    }),
    writePrivateState: async (state) => events.push(["state", Boolean(state.fixtureId), Boolean(state.priorActiveProjectId)]),
    removePrivateState: async () => events.push(["remove-state"])
  });

  const state = await lifecycle.create(new Date("2026-01-01T00:00:00Z"));
  assert.deepEqual(events.slice(0, 3), [["suspend", "prior"], ["save", "draft_editing"], ["state", true, true]]);
  await lifecycle.cleanup(state);
  assert.deepEqual(events.slice(3), [["delete", state.fixtureId], ["restore", "prior"], ["remove-state"]]);
});

test("failed private state write rolls back only the new fixture and restores prior active", async () => {
  const events = [];
  const lifecycle = prepareFixtureLifecycle({
    accountId: "7",
    findActive: async () => ({ id: "prior", state: "done", isActive: true }),
    transaction: async (work) => work({
      suspendPrior: async (id) => events.push(["suspend", id]),
      saveFixture: async (fixture) => events.push(["save", fixture.id]),
      deleteFixture: async (id) => events.push(["delete", id]),
      restorePrior: async (id) => events.push(["restore", id])
    }),
    writePrivateState: async () => { throw new Error("state_write_failed"); },
    removePrivateState: async () => events.push(["remove-state"])
  });

  await assert.rejects(() => lifecycle.create(new Date("2026-01-01T00:00:00Z")), /state_write_failed/);
  assert.equal(events[2][0], "delete");
  assert.deepEqual(events[3], ["restore", "prior"]);
});
