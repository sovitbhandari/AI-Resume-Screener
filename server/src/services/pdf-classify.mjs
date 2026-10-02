export const classifyParserError = (message) => (/password|encrypt/i.test(message) ? 'encrypted' : 'malformed')
