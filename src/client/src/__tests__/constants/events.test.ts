import { CLIENT_EVENTS, SERVER_EVENTS } from "@/constants/events";

describe("CLIENT_EVENTS", () => {
	it("is an object", () => {
		expect(typeof CLIENT_EVENTS).toBe("object");
		expect(CLIENT_EVENTS).not.toBeNull();
	});

	it("has at least one key", () => {
		expect(Object.keys(CLIENT_EVENTS).length).toBeGreaterThan(0);
	});

	it("all values are non-empty strings", () => {
		Object.values(CLIENT_EVENTS).forEach((value) => {
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		});
	});

	it("all keys are non-empty strings", () => {
		Object.keys(CLIENT_EVENTS).forEach((key) => {
			expect(typeof key).toBe("string");
			expect(key.length).toBeGreaterThan(0);
		});
	});

	it("has page and auth events", () => {
		expect(CLIENT_EVENTS.PAGE_VISITED).toBe("PAGE_VISITED");
		expect(CLIENT_EVENTS.LOGIN).toBe("USER_LOGIN");
		expect(CLIENT_EVENTS.REGISTER).toBe("USER_REGISTER");
	});

	it("has database config events", () => {
		expect(CLIENT_EVENTS.DB_CONFIG_ADD_SUCCESS).toBe("DB_CONFIG_ADD_SUCCESS");
		expect(CLIENT_EVENTS.DB_CONFIG_UPDATE_SUCCESS).toBe(
			"DB_CONFIG_UPDATE_SUCCESS"
		);
		expect(CLIENT_EVENTS.DB_CONFIG_ADD_FAILURE).toBe("DB_CONFIG_ADD_FAILURE");
		expect(CLIENT_EVENTS.DB_CONFIG_UPDATE_FAILURE).toBe(
			"DB_CONFIG_UPDATE_FAILURE"
		);
	});

	it("has profile events", () => {
		expect(CLIENT_EVENTS.PROFILE_UPDATE_SUCCESS).toBe("PROFILE_UPDATE_SUCCESS");
		expect(CLIENT_EVENTS.PROFILE_UPDATE_FAILURE).toBe("PROFILE_UPDATE_FAILURE");
	});

	it("has API key events", () => {
		expect(CLIENT_EVENTS.API_KEY_ADD_SUCCESS).toBe("API_KEY_ADD_SUCCESS");
		expect(CLIENT_EVENTS.API_KEY_ADD_FAILURE).toBe("API_KEY_ADD_FAILURE");
	});

	it("has prompt events", () => {
		expect(CLIENT_EVENTS.PROMPT_ADD_SUCCESS).toBe("PROMPT_ADD_SUCCESS");
		expect(CLIENT_EVENTS.PROMPT_ADD_FAILURE).toBe("PROMPT_ADD_FAILURE");
		expect(CLIENT_EVENTS.PROMPT_VERSION_ADD_SUCCESS).toBe(
			"PROMPT_VERSION_ADD_SUCCESS"
		);
		expect(CLIENT_EVENTS.PROMPT_VERSION_ADD_FAILURE).toBe(
			"PROMPT_VERSION_ADD_FAILURE"
		);
	});

	it("has vault events", () => {
		expect(CLIENT_EVENTS.VAULT_SECRET_ADD_SUCCESS).toBe(
			"VAULT_SECRET_ADD_SUCCESS"
		);
		expect(CLIENT_EVENTS.VAULT_SECRET_UPDATE_SUCCESS).toBe(
			"VAULT_SECRET_UPDATE_SUCCESS"
		);
		expect(CLIENT_EVENTS.VAULT_SECRET_ADD_FAILURE).toBe(
			"VAULT_SECRET_ADD_FAILURE"
		);
		expect(CLIENT_EVENTS.VAULT_SECRET_UPDATE_FAILURE).toBe(
			"VAULT_SECRET_UPDATE_FAILURE"
		);
	});

	it("has openground events", () => {
		expect(CLIENT_EVENTS.OPENGROUND_EVALUATION_SUCCESS).toBe(
			"OPENGROUND_EVALUATION_SUCCESS"
		);
		expect(CLIENT_EVENTS.OPENGROUND_EVALUATION_FAILURE).toBe(
			"OPENGROUND_EVALUATION_FAILURE"
		);
	});

	it("has filter events", () => {
		expect(CLIENT_EVENTS.REFRESH_RATE_CHANGE).toBe("REFRESH_RATE_CHANGE");
		expect(CLIENT_EVENTS.TIME_FILTER_CHANGE).toBe("TIME_FILTER_CHANGE");
		expect(CLIENT_EVENTS.TRACE_FILTER_APPLIED).toBe("TRACE_FILTER_APPLIED");
		expect(CLIENT_EVENTS.TRACE_FILTER_CLEARED).toBe("TRACE_FILTER_CLEARED");
	});

	it("has evaluation config events", () => {
		expect(CLIENT_EVENTS.EVALUATION_CONFIG_CREATED_SUCCESS).toBe(
			"EVALUATION_CONFIG_CREATED_SUCCESS"
		);
		expect(CLIENT_EVENTS.EVALUATION_CONFIG_UPDATED_SUCCESS).toBe(
			"EVALUATION_CONFIG_UPDATED_SUCCESS"
		);
		expect(CLIENT_EVENTS.EVALUATION_CONFIG_CREATED_FAILURE).toBe(
			"EVALUATION_CONFIG_CREATED_FAILURE"
		);
		expect(CLIENT_EVENTS.EVALUATION_CONFIG_UPDATED_FAILURE).toBe(
			"EVALUATION_CONFIG_UPDATED_FAILURE"
		);
	});

	it("has dashboard events", () => {
		expect(CLIENT_EVENTS.DASHBOARD_VIEWED).toBe("DASHBOARD_VIEWED");
		expect(CLIENT_EVENTS.DASHBOARD_WIDGET_ADDED).toBe("DASHBOARD_WIDGET_ADDED");
		expect(CLIENT_EVENTS.DASHBOARD_CREATED).toBe("DASHBOARD_CREATED");
		expect(CLIENT_EVENTS.DASHBOARD_UPDATED).toBe("DASHBOARD_UPDATED");
		expect(CLIENT_EVENTS.DASHBOARD_DELETED).toBe("DASHBOARD_DELETED");
	});

	it("has fleet hub events", () => {
		expect(CLIENT_EVENTS.FLEET_HUB_VIEWED).toBe("FLEET_HUB_VIEWED");
		expect(CLIENT_EVENTS.FLEET_HUB_AGENT_VIEWED).toBe("FLEET_HUB_AGENT_VIEWED");
		expect(CLIENT_EVENTS.FLEET_HUB_AGENT_CONFIG_SAVED).toBe(
			"FLEET_HUB_AGENT_CONFIG_SAVED"
		);
	});

	it("has organisation events", () => {
		expect(CLIENT_EVENTS.ORGANISATION_SWITCHED).toBe("ORGANISATION_SWITCHED");
		expect(CLIENT_EVENTS.ORGANISATION_CREATED).toBe("ORGANISATION_CREATED");
		expect(CLIENT_EVENTS.ORGANISATION_UPDATED).toBe("ORGANISATION_UPDATED");
		expect(CLIENT_EVENTS.ORGANISATION_DELETED).toBe("ORGANISATION_DELETED");
		expect(CLIENT_EVENTS.ORGANISATION_MEMBER_INVITED).toBe(
			"ORGANISATION_MEMBER_INVITED"
		);
		expect(CLIENT_EVENTS.ORGANISATION_MEMBER_REMOVED).toBe(
			"ORGANISATION_MEMBER_REMOVED"
		);
		expect(CLIENT_EVENTS.ORGANISATION_MEMBER_ROLE_UPDATED).toBe(
			"ORGANISATION_MEMBER_ROLE_UPDATED"
		);
		expect(CLIENT_EVENTS.ORGANISATION_INVITATION_ACCEPTED).toBe(
			"ORGANISATION_INVITATION_ACCEPTED"
		);
		expect(CLIENT_EVENTS.ORGANISATION_INVITATION_DECLINED).toBe(
			"ORGANISATION_INVITATION_DECLINED"
		);
		expect(CLIENT_EVENTS.ORGANISATION_INVITATION_CANCELLED).toBe(
			"ORGANISATION_INVITATION_CANCELLED"
		);
	});

	it("all values are unique", () => {
		const values = Object.values(CLIENT_EVENTS);
		const uniqueValues = new Set(values);
		expect(uniqueValues.size).toBe(values.length);
	});
});

describe("SERVER_EVENTS", () => {
	it("is an object", () => {
		expect(typeof SERVER_EVENTS).toBe("object");
		expect(SERVER_EVENTS).not.toBeNull();
	});

	it("has at least one key", () => {
		expect(Object.keys(SERVER_EVENTS).length).toBeGreaterThan(0);
	});

	it("all values are non-empty strings", () => {
		Object.values(SERVER_EVENTS).forEach((value) => {
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		});
	});

	it("has prompt SDK events", () => {
		expect(SERVER_EVENTS.PROMPT_SDK_FETCH_SUCCESS).toBe(
			"PROMPT_SDK_FETCH_SUCCESS"
		);
		expect(SERVER_EVENTS.PROMPT_SDK_FETCH_FAILURE).toBe(
			"PROMPT_SDK_FETCH_FAILURE"
		);
	});

	it("has vault SDK events", () => {
		expect(SERVER_EVENTS.VAULT_SECRET_SDK_FETCH_SUCCESS).toBe(
			"VAULT_SECRET_SDK_FETCH_SUCCESS"
		);
		expect(SERVER_EVENTS.VAULT_SECRET_SDK_FETCH_FAILURE).toBe(
			"VAULT_SECRET_SDK_FETCH_FAILURE"
		);
	});

	it("has evaluation auto events", () => {
		expect(SERVER_EVENTS.EVALUATION_AUTO_SUCCESS).toBe(
			"EVALUATION_AUTO_SUCCESS"
		);
		expect(SERVER_EVENTS.EVALUATION_AUTO_FAILURE).toBe(
			"EVALUATION_AUTO_FAILURE"
		);
	});

	it("has folder events", () => {
		expect(SERVER_EVENTS.FOLDER_CREATE_SUCCESS).toBe("FOLDER_CREATE_SUCCESS");
		expect(SERVER_EVENTS.FOLDER_CREATE_FAILURE).toBe("FOLDER_CREATE_FAILURE");
		expect(SERVER_EVENTS.FOLDER_DELETE_SUCCESS).toBe("FOLDER_DELETE_SUCCESS");
		expect(SERVER_EVENTS.FOLDER_DELETE_FAILURE).toBe("FOLDER_DELETE_FAILURE");
	});

	it("has dashboard server events", () => {
		expect(SERVER_EVENTS.DASHBOARD_CREATE_SUCCESS).toBe(
			"DASHBOARD_CREATE_SUCCESS"
		);
		expect(SERVER_EVENTS.DASHBOARD_CREATE_FAILURE).toBe(
			"DASHBOARD_CREATE_FAILURE"
		);
		expect(SERVER_EVENTS.DASHBOARD_UPDATE_SUCCESS).toBe(
			"DASHBOARD_UPDATE_SUCCESS"
		);
		expect(SERVER_EVENTS.DASHBOARD_UPDATE_FAILURE).toBe(
			"DASHBOARD_UPDATE_FAILURE"
		);
		expect(SERVER_EVENTS.DASHBOARD_DELETE_SUCCESS).toBe(
			"DASHBOARD_DELETE_SUCCESS"
		);
		expect(SERVER_EVENTS.DASHBOARD_DELETE_FAILURE).toBe(
			"DASHBOARD_DELETE_FAILURE"
		);
	});

	it("has dashboard widget events", () => {
		expect(SERVER_EVENTS.DASHBOARD_WIDGET_CREATE_SUCCESS).toBe(
			"DASHBOARD_WIDGET_CREATE_SUCCESS"
		);
		expect(SERVER_EVENTS.DASHBOARD_WIDGET_CREATE_FAILURE).toBe(
			"DASHBOARD_WIDGET_CREATE_FAILURE"
		);
		expect(SERVER_EVENTS.DASHBOARD_WIDGET_UPDATE_SUCCESS).toBe(
			"DASHBOARD_WIDGET_UPDATE_SUCCESS"
		);
		expect(SERVER_EVENTS.DASHBOARD_WIDGET_UPDATE_FAILURE).toBe(
			"DASHBOARD_WIDGET_UPDATE_FAILURE"
		);
		expect(SERVER_EVENTS.DASHBOARD_WIDGET_DELETE_SUCCESS).toBe(
			"DASHBOARD_WIDGET_DELETE_SUCCESS"
		);
		expect(SERVER_EVENTS.DASHBOARD_WIDGET_DELETE_FAILURE).toBe(
			"DASHBOARD_WIDGET_DELETE_FAILURE"
		);
	});

	it("all values are unique", () => {
		const values = Object.values(SERVER_EVENTS);
		const uniqueValues = new Set(values);
		expect(uniqueValues.size).toBe(values.length);
	});
});
