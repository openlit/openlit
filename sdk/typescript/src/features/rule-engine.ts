import OpenlitConfig from '../config';
import { OPENLIT_URL } from '../constant';
import { RuleEngineOptions, RuleEngineResult } from '../types';

export default class RuleEngine {
  static async evaluateRule(
    options: RuleEngineOptions
  ): Promise<RuleEngineResult | { err: string }> {
    const url = process.env.OPENLIT_URL || options.url || OPENLIT_URL;
    const apiKey = process.env.OPENLIT_API_KEY || options.apiKey || '';

    const metaProperties = {
      applicationName: OpenlitConfig.applicationName,
      environment: OpenlitConfig.environment,
    };

    try {
      const response = await fetch(`${url}/api/rule-engine/evaluate`, {
        method: 'POST',
        body: JSON.stringify({
          entity_type: options.entityType,
          fields: options.fields,
          include_entity_data: options.includeEntityData || false,
          entity_inputs: options.entityInputs,
          metaProperties,
          source: 'ts-sdk',
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })
        .then(async (response: any) => {
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

      return response;
    } catch (e: any) {
      console.log(e);
      if (e && typeof e.toString === 'function') {
        return {
          err: `Openlit Error : ${e.toString()}`,
          data: null,
        } as any;
      }

      return {
        err: `Openlit Error : ${e}`,
      };
    }
  }
}
