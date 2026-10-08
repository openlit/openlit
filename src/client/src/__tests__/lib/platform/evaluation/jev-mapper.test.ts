import {
	buildSystemOneRequest,
	mapSystemOneAnswers,
	questionKindForType,
	resolveJevTypes,
	scoreCriteria,
	JEV_QUALITY_SCORE_LEVELS,
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
			expect(body.questions.relevance.criteria).toEqual(scoreCriteria({ id: 'relevance' }));
			expect(body.questions.relevance.criteria).toHaveLength(4);
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
					legend: { '3': 'Does not address the prompt or is largely off topic' },
					confidence: 0.91,
					probabilities: { '0': 0.01, '3': 0.9 },
				},
			},
			thresholdScore: 0.5,
		});

		expect(mapped.evaluations[0].score).toBe(1);
		expect(mapped.evaluations[0].classification).toBe('severe');
		expect(mapped.evaluations[0].explanation).toBe(
			'Relevance classified as severe (score 1.00): Does not address the prompt or is largely off topic'
		);
		expect(mapped.evaluations[0].verdict).toBe('yes');
		expect(JSON.parse(mapped.extraMeta.confidence)).toEqual({ Relevance: 0.91 });
		expect(JSON.parse(mapped.extraMeta.probabilities)).toEqual({
			Relevance: { '0': 0.01, '3': 0.9 },
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

	it('skips requested types the judge did not answer instead of reporting a pass', () => {
		const { evaluations } = mapSystemOneAnswers({
			types: [
				{ id: 'hallucination', label: 'Hallucination' },
				{ id: 'bias', label: 'Bias' },
			],
			answers: { hallucination: { type: 'noul', noul: 0.9 } },
		});
		expect(evaluations.map((e) => e.evaluation)).toEqual(['Hallucination']);
		expect(evaluations[0].verdict).toBe('yes');
	});

	it('returns no evaluations when the response has no answers', () => {
		const { evaluations } = mapSystemOneAnswers({ answers: {} });
		expect(evaluations).toEqual([]);
	});

	it('clamps out-of-range quality scores so severity and classification agree', () => {
		const types = [{ id: 'relevance', label: 'Relevance' }];
		const high = mapSystemOneAnswers({
			types,
			answers: { relevance: { type: 'score', score: 7 } },
		}).evaluations[0];
		expect(high.score).toBe(1);
		expect(high.classification).toBe('severe');
		expect(high.verdict).toBe('yes');

		const low = mapSystemOneAnswers({
			types,
			answers: { relevance: { type: 'score', score: -2 } },
		}).evaluations[0];
		expect(low.score).toBe(0);
		expect(low.classification).toBe('none');
		expect(low.verdict).toBe('no');
	});

	it('skips unexpected choice answers instead of reporting a pass', () => {
		const { evaluations } = mapSystemOneAnswers({
			types: [{ id: 'hallucination', label: 'Hallucination' }],
			answers: { hallucination: { type: 'choice', choice: 'yes' } },
		});
		expect(evaluations).toEqual([]);
	});

	it('uses the interpolated score for severity and the nearest level for the label', () => {
		const [ev] = mapSystemOneAnswers({
			types: [{ id: 'completeness', label: 'Completeness' }],
			answers: {
				completeness: {
					type: 'score',
					score: 1.43,
					confidence: 0.35,
					legend: {
						'1': 'Covers the main points but omits a minor detail',
						'2': 'Omits a significant part of what the prompt asks for',
					},
					probabilities: { '1': 0.57, '2': 0.43 },
				},
			},
			thresholdScore: 0.5,
		}).evaluations;
		// 1.43 / 3 keeps the fractional position instead of rounding to level 1.
		expect(ev.score).toBeCloseTo(1.43 / 3, 5);
		expect(ev.classification).toBe('minor');
		expect(ev.explanation).toContain('Covers the main points but omits a minor detail');
		expect(ev.verdict).toBe('no');
	});

	it('still labels the score when the response carries no legend', () => {
		const [ev] = mapSystemOneAnswers({
			types: [{ id: 'conciseness', label: 'Conciseness' }],
			answers: { conciseness: { type: 'score', score: 2 } },
		}).evaluations;
		expect(ev.classification).toBe('moderate');
		expect(ev.explanation).toBe('Conciseness classified as moderate (score 0.67)');
	});

	describe('score rubrics', () => {
		const QUALITY_IDS = [
			'relevance',
			'coherence',
			'faithfulness',
			'instruction_following',
			'completeness',
			'conciseness',
		];

		it.each(QUALITY_IDS)('%s has a distinct descriptive rubric within API limits', (id) => {
			const criteria = scoreCriteria({ id });
			expect(criteria).toHaveLength(JEV_QUALITY_SCORE_LEVELS.length);
			expect(criteria.length).toBeGreaterThanOrEqual(2);
			expect(criteria.length).toBeLessThanOrEqual(10);
			expect(new Set(criteria).size).toBe(criteria.length);
			// Describe situations, not degrees: no bare one-word levels.
			for (const level of criteria) expect(level.split(' ').length).toBeGreaterThan(3);
		});

		it('falls back to a labelled rubric for unknown quality ids', () => {
			const criteria = scoreCriteria({ id: 'tone', label: 'Tone' });
			expect(criteria).toHaveLength(4);
			expect(criteria[0]).toContain('Tone');
		});
	});
});
