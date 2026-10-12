import { describe, expect, it } from "vitest";

import { maintenanceDecision, operationsSimulations, previewOperationsDocument, publicHttpUrl, redactText } from "./operations.js";
import { openSecret, sealSecret } from "./secrets.js";

describe("operations controls", () => {
  it("rejects private destinations and secret fields, and keeps a preview unsaved", () => {
    expect(publicHttpUrl("https://example.com/feed.json")).toBe("allowed");
    expect(publicHttpUrl("http://127.0.0.1/admin")).toBe("rejected");
    expect(publicHttpUrl("http://169.254.169.254/latest")).toBe("rejected");
    expect(publicHttpUrl("https://10.1.1.1/feed")).toBe("rejected");
    const preview = previewOperationsDocument({ label: "Hall", url: "https://example.com/rules", token: "hidden" });
    expect(preview.persisted).toBe(false);
    expect(preview.ok).toBe(false);
    const clean = previewOperationsDocument({ label: "Hall", url: "https://example.com/rules" });
    expect(clean.ok).toBe(true);
    expect(clean.persisted).toBe(false);
  });

  it("keeps verification available and reports simulations without a grant", () => {
    expect(maintenanceDecision("verification", true)).toBe("protected");
    expect(maintenanceDecision("moderation", true)).toBe("protected");
    expect(maintenanceDecision("economy", true)).toBe("allowed");
    const simulation = operationsSimulations();
    expect(simulation.persisted).toBe(false);
    expect(simulation.grants).toBe("none");
    expect(simulation.economy.routineMarks).toBe(7987);
    expect(simulation.blackjack.worstPlayerLossMarks).toBe(40);
    expect(simulation.ingots.conserved).toBe(true);
    expect(simulation.ingots.total).toBe("5000");
    expect(redactText("posted token=abc123")).toBe("posted token=[redacted]");
  });

  it("seals a secret so the stored text is not the plaintext", () => {
    const sealed = sealSecret("rehearsal-secret", "rehearsal-passphrase");
    expect(sealed.includes("rehearsal-secret")).toBe(false);
    expect(openSecret(sealed, "rehearsal-passphrase")).toBe("rehearsal-secret");
    expect(() => openSecret(sealed, "wrong-passphrase")).toThrow();
    expect(() => sealSecret("value", "  ")).toThrow(/setup_required/);
  });
});
