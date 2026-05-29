import getMessage from "@/constants/messages";
import * as enMessages from "@/constants/messages/en";

describe("getMessage()", () => {
	it("returns an object", () => {
		const messages = getMessage();
		expect(typeof messages).toBe("object");
		expect(messages).not.toBeNull();
	});

	it("returns the en messages", () => {
		const messages = getMessage();
		expect(messages).toBe(enMessages);
	});

	it("has DATABASE_CONFIG_NOT_FOUND", () => {
		const { DATABASE_CONFIG_NOT_FOUND } = getMessage();
		expect(typeof DATABASE_CONFIG_NOT_FOUND).toBe("string");
		expect(DATABASE_CONFIG_NOT_FOUND.length).toBeGreaterThan(0);
	});

	it("has UNAUTHORIZED_USER", () => {
		const { UNAUTHORIZED_USER } = getMessage();
		expect(typeof UNAUTHORIZED_USER).toBe("string");
		expect(UNAUTHORIZED_USER).toBe("Unauthorized user!");
	});

	it("has MALFORMED_INPUTS", () => {
		const { MALFORMED_INPUTS } = getMessage();
		expect(typeof MALFORMED_INPUTS).toBe("string");
	});

	it("has prompt-related messages", () => {
		const msgs = getMessage();
		expect(msgs.NO_PROMPT).toBeDefined();
		expect(msgs.PROMPT_SAVED).toBe("Prompt saved successfully!");
		expect(msgs.PROMPT_DELETED).toBe("Prompt deleted successfully!");
	});

	it("has vault-related messages", () => {
		const msgs = getMessage();
		expect(msgs.SECRET_SAVED).toBe("Secret saved successfully!");
		expect(msgs.SECRET_DELETED).toBe("Secret deleted successfully!");
	});

	it("has evaluation-related messages", () => {
		const msgs = getMessage();
		expect(msgs.EVALUATION_CONFIG_NOT_FOUND).toBeDefined();
		expect(msgs.EVALUATION_CREATED).toBe("Evaluation created successfully!");
		expect(msgs.EVALUATION_UPDATED).toBe("Evaluation updated successfully!");
	});

	it("has rule engine messages", () => {
		const msgs = getMessage();
		expect(msgs.RULE_CREATED).toBe("Rule created successfully!");
		expect(msgs.RULE_UPDATED).toBe("Rule updated successfully!");
		expect(msgs.RULE_DELETED).toBe("Rule deleted successfully!");
		expect(msgs.RULE_NOT_FOUND).toBe("Rule not found!");
	});

	it("has organisation messages", () => {
		const msgs = getMessage();
		expect(msgs.ORGANISATION_CREATED).toBe("Organisation created successfully");
		expect(msgs.ORGANISATION_UPDATED).toBe("Organisation updated successfully");
		expect(msgs.ORGANISATION_DELETED).toBe("Organisation deleted successfully");
	});

	it("has generic UI text", () => {
		const msgs = getMessage();
		expect(msgs.LOADING).toBe("Loading");
		expect(msgs.CANCEL).toBe("Cancel");
		expect(msgs.DELETE).toBe("Delete");
		expect(msgs.SAVE).toBe("Save");
	});

	it("has context-related messages", () => {
		const msgs = getMessage();
		expect(msgs.CONTEXT_CREATED).toBe("Context created successfully!");
		expect(msgs.CONTEXT_UPDATED).toBe("Context updated successfully!");
		expect(msgs.CONTEXT_DELETED).toBe("Context deleted successfully!");
	});

	it("returns the same object on repeated calls", () => {
		expect(getMessage()).toBe(getMessage());
	});
});
