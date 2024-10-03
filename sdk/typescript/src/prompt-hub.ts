import OpenlitConfig from './config';
import { OPENLIT_URL } from './constant';
import { PromptHubOptions } from './types';

export default class PromptHub {
  static async getPrompts(options: PromptHubOptions) {
    const url = process.env.OPENLIT_URL || options.url || OPENLIT_URL;
    const apiKey = process.env.OPENLIT_API_KEY || options.apiKey;
    let metaProperties = {
      applicationName: OpenlitConfig.applicationName,
      environment: OpenlitConfig.environment,
    };
    if (
      options.metaProperties &&
      typeof options.metaProperties === 'object' &&
      !Array.isArray(options.metaProperties)
    ) {
      metaProperties = {
        ...metaProperties,
        ...options.metaProperties,
      };
    }

    try {
      const data = await fetch(`${url}/api/prompt/get-compiled`, {
        method: 'POST',
        body: JSON.stringify({
          name: options.name,
          apiKey,
          compile: !!options.compile,
          variables: options.variables || {},
          id: options.promptId,
          metaProperties,
          source: 'ts-sdk',
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            return {
              err: `Openlit Error : HTTP error! Status: ${response.status}`,
            };
          }
          return response.json();
        })
        .then((resp: any) => {
          return resp;
        });
      return data;
    } catch (e: any) {
      if (e && typeof e.toString === 'function') {
        return {
          err: `Openlit Error : ${e.toString()}`,
          data: null,
        };
      }

      return {
        err: `Openlit Error : ${e}`,
      };
    }
  }
}
