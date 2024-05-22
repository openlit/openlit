import { omit } from "lodash";
import OpenAI from "openai";
import openLit from "@openlit/node";

openLit.init();

export async function chatCompletion(params: any) {
	const openai = new OpenAI({
		apiKey: params.api_key || process.env["OPENAI_API_KEY"], // This is the default and can be omitted
	});

	const updatedParams = omit(params, ["api_key", "prompt"]);
	updatedParams.messages = [{ role: "user", content: params.prompt }];
	updatedParams.max_tokens = 1;
	return await openai.chat.completions.create(updatedParams as any);
}
