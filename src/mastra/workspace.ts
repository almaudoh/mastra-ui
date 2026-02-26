import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

export const workspace = new Workspace({
	filesystem: new LocalFilesystem({ basePath: './workspace' }),
	sandbox: new LocalSandbox({ workingDirectory: './workspace' }),
});

