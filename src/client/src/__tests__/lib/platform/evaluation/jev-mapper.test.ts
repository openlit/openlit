import {
	buildSystemOneRequest,
	mapSystemOneAnswers,
	questionKindForType,
	resolveJevTypes,
	stripEvaluationContextHeader,
	TYPESAFE_PROVIDER_ID,
} from '@/lib/platform/evaluation/jev-mapper';

describe('jev-mapper', () => {
	it('strips evaluation context headers from stored prompts', () => {
		expect(
			stripEvaluationContextHeader(
				'[Hallucination evaluation context]\nFlag invented claims.'
			)
		).toBe('Flag invented claims.');
	});

	it('defaults to hallucination, bias, and toxicity when no types are passed', () => {
		const types = resolveJevTypes();
		expect(types.map((t) => t.id)).toEqual(['hallucination', 'bias', 'toxicity']);
	});

	it('maps issue types to noul and quality types to score', () => {
		expect(questionKindForType({ id: 'hallucination' })).toBe('noul');
		expect(questionKindForType({ id: 'safety' })).toBe('noul');
		expect(questionKindForType({ id: 'relevance' })).toBe('score');
		expect(questionKindForType({ id: 'completeness' })).toBe('score');
		expect(questionKindForType({ id: 'domain_accuracy', isCustom: true })).toBe('noul');
	});

	it('builds one System One request with parallel questions per type', () => {
		const body = buildSystemOneRequest({
			prompt: 'What is 2+2?',
			response: '5',
			groundTruthContext: '2+2=4',
			model: 'jev-latest',
			evaluationTypes: [
				{ id: 'hallucination', label: 'Hallucination', prompt: '[Hallucination evaluation context]\nFlag invented claims.' },
				{ id: 'relevance', label: 'Relevance', prompt: 'Stay on topic.' },
			],
		});

		expect(body.state).toEqual({
			prompt: 'What is 2+2?',
			response: '5',
			ground_truth_context: '2+2=4',
		});
		expect(body.questions.hallucination).toEqual({
			type: 'noul',
			instructions: 'Flag invented claims.',
		});
		expect(body.questions.relevance.type).toBe('score');
		if (body.questions.relevance.type === 'score') {
			expect(body.questions.relevance.criteria).toEqual([
				'none',
				'minor',
				'moderate',
				'severe',
			]);
		}
	});

	it('maps noul answers to Evaluation rows without inventing confidence', () => {
		const mapped = mapSystemOneAnswers({
			types: [{ id: 'hallucination', label: 'Hallucination' }],
			answers: { hallucination: { type: 'noul', noul: 0.8 } },
			thresholdScore: 0.5,
			resolvedModel: 'jev-1.13.0',
		});

		expect(mapped.evaluations).toHaveLength(1);
		expect(mapped.evaluations[0]).toMatchObject({
			score: 0.8,
			evaluation: 'Hallucination',
			classification: 'detected',
			explanation: 'Hallucination detected (score 0.80)',
			verdict: 'yes',
		});
		expect(mapped.extraMeta.engine).toBe(TYPESAFE_PROVIDER_ID);
		expect(mapped.extraMeta.resolvedModel).toBe('jev-1.13.0');
		expect(mapped.extraMeta.confidence).toBeUndefined();
	});

	it('normalizes quality scores with score/(n-1) and stores confidence', () => {
		const mapped = mapSystemOneAnswers({
			types: [{ id: 'relevance', label: 'Relevance' }],
			answers: {
				relevance: {
					type: 'score',
					score: 3,
					legend: 'severe',
					confidence: 0.91,
					probabilities: { none: 0.01, severe: 0.9 },
				},
			},
			thresholdScore: 0.5,
		});

		expect(mapped.evaluations[0].score).toBe(1);
		expect(mapped.evaluations[0].classification).toBe('severe');
		expect(mapped.evaluations[0].explanation).toBe(
			'Relevance classified as severe (score 1.00)'
		);
		expect(mapped.evaluations[0].verdict).toBe('yes');
		expect(JSON.parse(mapped.extraMeta.confidence)).toEqual({ Relevance: 0.91 });
		expect(JSON.parse(mapped.extraMeta.probabilities)).toEqual({
			Relevance: { none: 0.01, severe: 0.9 },
		});
	});

	it('uses classification buckets as the explanation', () => {
		const none = mapSystemOneAnswers({
			types: [{ id: 'hallucination', label: 'Hallucination' }],
			answers: { hallucination: { type: 'noul', noul: 0 } },
		});
		expect(none.evaluations[0]).toMatchObject({
			classification: 'none',
			explanation: 'No Hallucination detected',
			verdict: 'no',
		});

		const moderate = mapSystemOneAnswers({
			types: [{ id: 'hallucination', label: 'Hallucination' }],
			answers: { hallucination: { type: 'noul', noul: 0.3 } },
		});
		expect(moderate.evaluations[0]).toMatchObject({
			classification: 'moderate',
			explanation: 'Hallucination classified as moderate (score 0.30)',
			verdict: 'no',
		});
	});
});
