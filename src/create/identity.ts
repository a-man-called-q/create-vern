import { UserError } from "../system/errors";

/** What the template is renamed to. */
export interface ProjectIdentity {
	/** Display name, for example "Acme Platform". */
	name: string;
	/** Package slug, for example "acme-platform". */
	slug: string;
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function displayName(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/** The template's own rules, checked here first so a bad name fails before any download. */
export function validateIdentity(name: string, slug: string): void {
	if (!/^[\p{L}\p{N}][\p{L}\p{N} .-]*$/u.test(name.trim())) {
		throw new UserError(
			"The name may contain letters, numbers, spaces, periods, and hyphens.",
		);
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		throw new UserError(
			"The slug must be lowercase kebab-case (for example, acme-platform).",
		);
	}
}
