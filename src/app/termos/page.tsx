import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '@/components/legal/legal-document';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Termos de Uso | GFT Inteligente',
  robots: { index: false, follow: false }
};

const sections: LegalSection[] = [
  {
    heading: '1. Finalidade do sistema',
    paragraphs: [
      'O GFT Inteligente é um protótipo acadêmico para apoiar microempreendedores e pequenas empresas na organização de receitas, despesas, fluxo de caixa e informações de gestão. Ele não substitui contabilidade, consultoria tributária, orientação jurídica nem sistemas oficiais do governo.'
    ]
  },
  {
    heading: '2. Conta e responsabilidades',
    paragraphs: [
      'A pessoa usuária deve informar dados corretos, manter a senha em sigilo e utilizar apenas uma conta que esteja autorizada a representar a empresa cadastrada. O cadastro registra separadamente o aceite destes Termos de Uso e a ciência da Política de Privacidade, com as respectivas versões.'
    ]
  },
  {
    heading: '3. Registros financeiros',
    paragraphs: [
      'A pessoa usuária é responsável por conferir valores, datas, categorias e demais informações lançadas. O Dashboard apresenta cálculos a partir dos registros existentes e não confirma, por si só, a exatidão contábil ou fiscal dos dados.'
    ]
  },
  {
    heading: '4. Integrações e conteúdo gerado por IA',
    paragraphs: [
      'Quando uma consulta de CNPJ for solicitada, o sistema poderá encaminhar esse identificador à ReceitaWS para obter dados cadastrais disponíveis no serviço. Quando a pessoa usuária solicitar insights, o sistema encaminhará à API Gemini somente métricas financeiras agregadas e categorias controladas, sem descrição livre, nome da empresa, e-mail, CNPJ ou identificadores de usuário.' ,
      'Os insights são explicações automatizadas de apoio, podem conter limitações e não são recomendação de investimento, parecer contábil, cálculo oficial de tributo ou garantia de resultado. Confira os números no Dashboard e procure profissional habilitado quando necessário.'
    ]
  },
  {
    heading: '5. Uso adequado e disponibilidade',
    paragraphs: [
      'Não é permitido tentar acessar dados de outra empresa, interferir no serviço ou inserir informações de terceiros sem autorização e finalidade legítima. O protótipo pode apresentar indisponibilidade, erro de integração ou interrupção durante a avaliação acadêmica; não deve ser usado como único meio de controle financeiro ou cumprimento de obrigação legal.'
    ]
  },
  {
    heading: '6. Dúvidas e encerramento',
    paragraphs: [
      'A identificação do responsável pelo sistema e o canal institucional de atendimento ainda precisam ser preenchidos pela equipe do projeto antes de qualquer uso externo. O encerramento da conta e a retenção ou exclusão de dados deverão seguir a Política de Privacidade e os procedimentos definidos pelo responsável.'
    ]
  }
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Termos de Uso"
      version={process.env.TERMS_VERSION ?? '2026-10-01'}
      sections={sections}
      draftNotice="Este documento foi redigido para a demonstração do TCC. Antes de receber usuários externos ou dados reais, o responsável pelo projeto deve identificar o controlador, informar um canal de contato e submeter o texto à revisão apropriada."
    />
  );
}
