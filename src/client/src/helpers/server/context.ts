import { ContextInput } from "@/types/context";

const VALID_STATUSES = ["ACTIVE", "INACTIVE"];

export function verifyContextInput(input: Partial<ContextInput>) {
	if (!input.name || input.name.trim().length === 0) {
		return { success: false, err: "Context name is required!" };
	}
	if (!input.content || input.content.trim().length === 0) {
		return { success: false, err: "Context content is required!" };
	}
	if (input.status && !VALID_STATUSES.includes(input.status)) {
		return { success: false, err: "status must be ACTIVE or INACTIVE!" };
	}
	return { success: true };
}
