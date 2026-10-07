# App Louvor IMV

PWA de escalas, agenda, equipe, indisponibilidade e repertório do Ministério de Louvor da Igreja Metodista Valentim.

## Stack
- Frontend PWA estático
- Supabase (Auth + Postgres + Edge Functions)
- Render (deploy)

## Produção
https://app-louvor-imv.onrender.com

## Repositório
gabrielserafimss/app-louvor-imv

## Gerador de escalas

O calendário gera 24 cultos do ciclo inicial de 11/10/2026 a 01/12/2026, incluindo domingos às 08:00 e 18:30 e terças às 19:30. Depois desse ciclo, mantém uma janela recorrente de dois meses. O administrador pode usar **Gerar / atualizar escalas** para aplicar o padrão aos eventos existentes.

- Domingo de manhã alterna Gabriel Serafim e Nilma Vieira. Amanda e Cleidiene não entram nessa posição. Se ambos estiverem indisponíveis, a posição fica pendente.
- As equipes de instrumentistas A–D permanecem juntas nos dois cultos de domingo e alternam semanalmente. Se uma equipe não estiver disponível para ambos, o gerador procura outra equipe completa.
- Ministros mantêm seus pares de backs. Mesa de som e projeção alternam por carga mensal. Novos membros qualificados entram em equipes adicionais estáveis.
- O cadastro ativo do Supabase é a fonte de membros, funções e indisponibilidades. Nomes e aliases precisam identificar uma única pessoa; o gerador não cria perfis. Pessoas sem função não são escaladas.
- Confirmações existentes são preservadas. Regenerar não duplica posições ou avisos de novas escalas. Conflitos de confirmação exigem revisão antes de salvar.

O padrão inicial está em [rotation-pattern.js](rotation-pattern.js); o motor independente está em [scheduler.js](scheduler.js). As combinações iniciais foram definidas usando o histórico e as funções do Planning e podem ser ajustadas nesse arquivo. A [prévia dos 24 cultos](docs/escalas-outubro-dezembro-2026.md) usa o cadastro de referência; não representa uma gravação no banco de produção.

A aplicação continua estática, sem build ou dependências novas em produção e sem migração SQL. A gravação usa as tabelas existentes `profiles`, `events`, `event_assignments`, `unavailability` e `notifications`, sujeitas às permissões do administrador no Supabase. Na falha de inserção, tenta restaurar as posições pendentes removidas; essa recuperação não substitui uma transação no banco.

## Desenvolvimento e validação

Sirva a raiz com `python3 -m http.server 8765`. Para testar o motor, use `node --test tests/scheduler.test.js`. O teste do aplicativo usa Playwright e Chromium instalados no ambiente: `node --test tests/browser.test.js`.

O teste no navegador usa Supabase simulado, incluindo criação do ciclo, visualização mobile, regeneração e recuperação de erro. Não exige login nem altera dados de produção. A integração com as permissões reais do banco deve ser verificada após publicar a versão.
