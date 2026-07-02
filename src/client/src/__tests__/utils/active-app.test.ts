import { getActiveApp } from '@/utils/active-app';

describe('getActiveApp', () => {
	it('returns Prompts for prompt hub routes', () => {
		expect(getActiveApp('/prompt-hub')).toEqual({
			title: 'Prompts',
			href: '/prompt-hub',
		});
		expect(getActiveApp('/prompt-hub/my-prompt')).toEqual({
			title: 'Prompts',
			href: '/prompt-hub',
		});
	});

	it('returns sidebar apps for other routes', () => {
		expect(getActiveApp('/agents')).toEqual({
			title: 'Agents',
			href: '/agents',
		});
		expect(getActiveApp('/context')).toEqual({
			title: 'Contexts',
			href: '/context',
		});
		expect(getActiveApp('/home')).toEqual({
			title: 'Home',
			href: '/home',
		});
	});

	it('maps coding-agents routes to Agents', () => {
		expect(getActiveApp('/coding-agents/users/test@example.com')).toEqual({
			title: 'Agents',
			href: '/agents',
		});
	});

	it('maps dashboard uuid routes to Dashboards', () => {
		expect(
			getActiveApp('/d/12345678-1234-1234-1234-123456789012')
		).toEqual({
			title: 'Dashboards',
			href: '/dashboards',
		});
	});

	it('returns null for onboarding', () => {
		expect(getActiveApp('/onboarding')).toBeNull();
	});
});
