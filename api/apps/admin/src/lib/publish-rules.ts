export type PublishState = { templateLifecycle: string; versionStatus: string; pricingStatus: string | null; bindingCount: number; unpublishedBindingCount: number; inputSchemaValid: boolean };

export function validatePublishState(state: PublishState): string[] {
	const errors: string[] = [];
	if (state.templateLifecycle === "archived") errors.push("Archived templates cannot be published");
	if (state.versionStatus !== "draft") errors.push("Only draft versions can be published");
	if (state.pricingStatus !== "published") errors.push("A published pricing version is required");
	if (state.bindingCount < 1) errors.push("At least one active provider binding is required");
	if (state.unpublishedBindingCount > 0) errors.push("Every active provider binding must reference a published model version");
	if (!state.inputSchemaValid) errors.push("The restricted template input schema is invalid");
	return errors;
}

export function publishCommitSucceeded(input: {
	versionChanges: number;
	templateChanges: number;
	versionStatus: string | null;
	publishedAt: number | null;
	expectedPublishedAt: number;
	currentVersionId: string | null;
	expectedVersionId: string;
}): boolean {
	return input.versionChanges === 1
		&& input.templateChanges === 1
		&& input.versionStatus === "published"
		&& input.publishedAt === input.expectedPublishedAt
		&& input.currentVersionId === input.expectedVersionId;
}
