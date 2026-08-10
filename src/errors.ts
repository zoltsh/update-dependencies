export class UpdateDependenciesError extends Error {
    readonly code: string;

    constructor(code: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'UpdateDependenciesError';
        this.code = code;
    }
}

export function actionError(code: string, message: string, cause?: unknown): UpdateDependenciesError {
    return new UpdateDependenciesError(code, message, cause === undefined ? undefined : { cause });
}
