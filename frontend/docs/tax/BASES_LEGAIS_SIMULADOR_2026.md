# Base legal e limites do simulador tributário — referência 2026

**Consulta das fontes:** 9 de outubro de 2026\
**Escopo aprovado:** estimativas demonstrativas do Simples Nacional e inclusão do MEI, sem envio de declarações ou documentos de arrecadação.

## Fontes primárias consultadas

1. **Lei Complementar nº 123/2006 — texto consolidado**, Presidência da República/Planalto: <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm>. Consulta direta ao texto integral, inclusive art. 18 e Anexos I a V.
2. **MEI — atualização de valores devidos em 2026**, Receita Federal/Portal do Simples Nacional, publicada em 02/01/2026: <https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3>.
3. **Teto do MEI**, Ministério do Empreendedorismo, da Microempresa e da Empresa de Pequeno Porte, página publicada em 29/06/2026 e modificada em 16/09/2026: <https://www.gov.br/memp/pt-br/teto-do-mei>.
4. **Opção pelo Simples Nacional e escolha do modelo de recolhimento do IBS e da CBS em 2027**, Receita Federal, setembro de 2026: <https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/setembro/receita-federal-alerta-comeca-hoje-o-prazo-para-opcao-pelo-simples-nacional-e-para-a-escolha-do-modelo-de-recolhimento-do-ibs-e-da-cbs-em-2027>.

## Regras confirmadas

### Simples Nacional — base das tabelas

O art. 18 da LC nº 123/2006 determina que a faixa da alíquota nominal considere a receita bruta acumulada nos 12 meses anteriores ao período de apuração (RBT12). A alíquota efetiva é:

> **Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12**

A regra de estimativa mensal definida para a aplicação é **receita bruta do mês × alíquota efetiva**. As faixas e os parâmetros de alíquota nominal e parcela a deduzir, extraídos dos Anexos I–V consolidados, são:

| Faixa RBT12 (R$) | Anexo I — comércio (alíquota; dedução R$) | Anexo II — indústria | Anexo III — serviços/locação | Anexo IV — serviços específicos | Anexo V — serviços específicos |
|---|---:|---:|---:|---:|---:|
| Até 180.000 | 4,00%; 0 | 4,50%; 0 | 6,00%; 0 | 4,50%; 0 | 15,50%; 0 |
| 180.000,01–360.000 | 7,30%; 5.940 | 7,80%; 5.940 | 11,20%; 9.360 | 9,00%; 8.100 | 18,00%; 4.500 |
| 360.000,01–720.000 | 9,50%; 13.860 | 10,00%; 13.860 | 13,50%; 17.640 | 10,20%; 12.420 | 19,50%; 9.900 |
| 720.000,01–1.800.000 | 10,70%; 22.500 | 11,20%; 22.500 | 16,00%; 35.640 | 14,00%; 39.780 | 20,50%; 17.100 |
| 1.800.000,01–3.600.000 | 14,30%; 87.300 | 14,70%; 85.500 | 21,00%; 125.640 | 22,00%; 183.780 | 23,00%; 62.100 |
| 3.600.000,01–4.800.000 | 19,00%; 378.000 | 30,00%; 720.000 | 33,00%; 648.000 | 33,00%; 828.000 | 30,50%; 540.000 |

A tabela legal define os parâmetros de alíquota e dedução; ela **não classifica a atividade concreta** da empresa. Para atividades de serviço sujeitas ao Fator R, o art. 18, §§ 5º-J e 5º-M, prevê Anexo III quando a razão folha/receita é igual ou superior a 28%, e Anexo V quando inferior. O usuário deverá confirmar o anexo aplicável com profissional habilitado; a interface deverá apresentar essa ressalva. O Anexo IV não inclui CPP na partilha do DAS, podendo haver recolhimentos previdenciários externos ao cálculo simplificado.

### MEI / SIMEI — valores de 2026

Em 2026, a Receita Federal informa salário mínimo de **R$ 1.621,00** como base. A contribuição previdenciária ordinária de 5% corresponde a **R$ 81,05/mês**, acrescida de **R$ 1,00 de ICMS** quando devido e/ou **R$ 5,00 de ISS** quando devido. Para o MEI transportador autônomo de cargas, a contribuição previdenciária indicada é **R$ 194,52** (12% do salário mínimo); os adicionais de ICMS/ISS dependem da atividade. O simulador deverá permitir selecionar esses adicionais, em vez de inferir a atividade do contribuinte.

O MEMP confirma que o limite vigente de receita bruta anual permanece em **R$ 81.000**; o equivalente proporcional informado para início de atividade é **R$ 6.750 por mês de atividade**, contando fração de mês como mês completo. A proposta PLP nº 186/2026 menciona limites futuros de R$ 110.000 em 2027 e R$ 140.000 em 2028, mas a própria página oficial esclarece que **a proposta não está em vigor**. Esses limites propostos não serão usados pelo simulador. A página e suas respostas de perguntas frequentes foram conferidas diretamente em 9 de outubro de 2026.

## Limites da implementação demonstrativa

- O simulador exibe **ano-base 2026**; não projeta as opções de IBS/CBS ou a transição anunciada para 2027.
- É ferramenta educativa de estimativa, não enquadra atividades, não substitui contador/consultoria tributária, não gera DAS e não transmite PGDAS-D, DASN-SIMEI ou qualquer declaração.
- O anexo do Simples será selecionado pelo usuário, que deve confirmar o enquadramento. Não serão modeladas segregação de receitas, retenções, substituição tributária, monofásicos, sublimites estaduais/municipais, exceções legais ou a regra de início de atividade do Simples.
- A categoria MEI será tratada separadamente da estimativa de ME/EPP no Simples. O valor anual informado será comparado ao limite vigente/proporcional; ultrapassagens geram alerta para revisão profissional, sem cálculo automático de multas ou desenquadramento.
- Conforme o escopo previsto, a estimativa deve ser executada localmente na interface com os valores digitados, sem envio ao Gemini, persistência no banco ou transmissão de dados fiscais.
- O método previsto usa aritmética JavaScript `Number` e arredondamento final a duas casas; não é cálculo decimal exato nem apuração tributária oficial. A regra precisa de revisão profissional antes de qualquer uso operacional.

## Registro da implementação

As regras documentadas orientam `src/features/tax/simulator.ts`. O painel foi conferido no Dashboard autenticado em 15/10/2026: Anexo I, RBT12 de R$ 180.000 e receita mensal de R$ 15.000 resultaram em R$ 600; MEI de serviços, com faturamento de R$ 40.500 em 12 meses, resultou em R$ 86,05/mês e utilização de 50% do limite. O teste não constitui revisão fiscal independente.

Calendário e exportações continuam pendentes. Valores digitados no simulador não são persistidos nem enviados ao Gemini. O método usa JavaScript `Number` e arredondamento final a centavos; fórmulas, premissas e exceções precisam de revisão profissional antes do uso operacional. A consulta das fontes em 9/10/2026 não garante vigência futura.
