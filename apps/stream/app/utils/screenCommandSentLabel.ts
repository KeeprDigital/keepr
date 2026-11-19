import type { ScreenCommandRequest } from '~/types';

/**
 * What an operator is told once a Screen command is sent. For `debug` it says
 * which state was asked for: no page can read a Screen Output's debug panel, so
 * this is the only account of it an operator has.
 */
export function screenCommandSentLabel(command: ScreenCommandRequest): string {
	if (command.command === 'debug') {
		return command.shown ? 'Show debug panel command sent' : 'Hide debug panel command sent';
	}
	return command.command === 'refresh' ? 'Refresh command sent' : 'Identify command sent';
}
