export class UpdateDependenciesError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'UpdateDependenciesError';
        this.code = code;
    }
}
export function actionError(code, message, cause) {
    return new UpdateDependenciesError(code, message, cause === undefined ? undefined : { cause });
}
