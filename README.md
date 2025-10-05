# Worktree Helper VS Code Extension

Crie worktrees Git com os arquivos de ambiente configurados a partir do Command Palette do VS Code.

## Funcionalidades

- Solicita o nome da pasta (dentro de `worktree/`).
- Solicita o nome da branch a ser criada.
- Garante que `worktree/` esteja presente no `.gitignore` do projeto.
- Executa `git worktree add` no diretório raiz do workspace.
- Copia `.env` e `.env.local` para a nova worktree.
- Executa automaticamente o comando `install` do gerenciador de pacotes escolhido (ou permite pular).
- Suporta presets com caminhos adicionais que também recebem os arquivos de ambiente e comandos pós-criação.
- Abre atalhos para abrir a nova worktree, revelar o diretório no sistema ou visualizar os logs da execução.

## Pré-requisitos

- Node.js 18+
- npm 9+
- VS Code 1.87.0 ou superior
- [vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) instalado globalmente para empacotar a extensão (`npm install -g @vscode/vsce`).

## Instalação para desenvolvimento

```bash
cd vscode-worktree-helper
npm install
npm run compile
```

Em seguida, abra a pasta `vscode-worktree-helper` no VS Code e pressione `F5` para iniciar uma nova janela de desenvolvimento com a extensão carregada.

## Empacotar e instalar localmente

```bash
npm run package
code --install-extension worktree-helper-0.0.1.vsix
```

> Ajuste o nome do arquivo `.vsix` conforme a versão gerada pelo `vsce`.

## Uso

1. Abra o projeto principal no VS Code (a raiz que contém a pasta `worktree/`).
2. Abra o Command Palette (`Ctrl+Shift+P` ou `Cmd+Shift+P`).
3. Procure por **"Worktree Helper: Create New Worktree"**.
4. Informe o nome da pasta e da branch quando solicitado.
5. Escolha o gerenciador de pacotes (ou pule) quando solicitado.
6. Escolha o preset de configuração.
7. Aguarde a confirmação de sucesso e escolha se deseja abrir a worktree, revelar o diretório ou abrir os logs.

> Os logs da execução ficam disponíveis no painel **OUTPUT** do VS Code, canal "Worktree Helper".

## Presets

A extensão já vem com dois presets embutidos:

- **default** – Copia `.env`/`.env.local` para a raiz da worktree e executa `install` com o gerenciador de pacotes escolhido.
- **remetricate** – Mesmas ações do preset padrão + copia os arquivos de ambiente para `packages/workflow-platform`.

Você pode criar seus próprios presets através das configurações do VS Code (`Settings > Extensions > Worktree Helper` ou editando o `settings.json`):

```json
"worktree-helper.presets": [
	{
		"name": "monorepo",
		"description": "Copia .env para apps/app-a e roda npm install",
		"usePackageManagerInstall": true,
		"envTargets": ["apps/app-a"],
		"postCommands": [
			{
				"command": "npm",
				"args": ["install"],
				"cwd": "apps/app-a"
			}
		]
	}
]
```

- `envTargets`: caminhos relativos à raiz da worktree que também receberão os arquivos de ambiente.
- `postCommands`: comandos executados em série. O campo `cwd` pode ser relativo à worktree ou usar os placeholders `${workspaceRoot}` e `${worktreePath}`.
- `usePackageManagerInstall`: quando verdadeiro, adiciona automaticamente o comando `install` do gerenciador escolhido antes dos `postCommands` personalizados.

### Configurações rápidas

- `worktree-helper.packageManager`: define o gerenciador de pacotes padrão (`bun`, `npm`, `yarn`, `pnpm` ou `skip`).
- `worktree-helper.promptPackageManager`: quando ativo (padrão), pergunta qual gerenciador usar a cada criação de worktree.
- `worktree-helper.presets[].usePackageManagerInstall`: habilita o comando `install` automaticamente para o preset.

## Personalização

- O campo `publisher` em `package.json` pode ser ajustado para o identificador desejado antes de publicar.
- Use presets personalizados para estender o fluxo de criação sem precisar alterar o código.
- Se desejar comportamento diferente (ex.: copiar arquivos adicionais), adapte `src/extension.ts` conforme necessário.

## Estrutura

```
vscode-worktree-helper/
├─ dist/                # Saída compilada (gerada por npm run compile)
├─ node_modules/
├─ src/
│  └─ extension.ts      # Ponto de entrada da extensão
├─ package.json
├─ tsconfig.json
└─ README.md
```
