/** Set `KEY=value`, replacing the existing line or appending one. */
export function setEnvValue(content: string, key: string, value: string): string {
	const line = `${key}=${value}`;
	const pattern = new RegExp(`^${key}=.*$`, "m");
	if (pattern.test(content)) return content.replace(pattern, () => line);
	if (content === "" || content.endsWith("\n")) return `${content}${line}\n`;
	return `${content}\n${line}\n`;
}
