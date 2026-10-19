import type { Metadata } from 'next';
import { LegalDocument, type LegalSection } from '@/components/legal/legal-document';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Política de Privacidade | GFT Inteligente',
  robots: { index: false, follow: false }
};

const sections: LegalSection[] = [
  {
    heading: '1. Responsável e escopo desta minuta',
    paragraphs: [
      'Esta minuta descreve o tratamento de dados no protótipo acadêmico GFT Inteligente. O nome e os dados de contato do controlador ainda não foram informados e devem ser publicados antes do uso por pessoas externas. A base legal aplicável a cada finalidade também deve ser confirmada pelo responsável pelo tratamento.'
    ]
  },
  {
    heading: '2. Dados tratados e finalidades',
    paragraphs: ['Conforme as funcionalidades utilizadas, o protótipo pode tratar:'],
    points: [
      'Dados de conta: e-mail e credencial armazenada como hash bcrypt, para autenticar o acesso.',
      'Dados da empresa: nome e vínculo de acesso/declaração de perfil, para separar a área de cada empresa.',
      'Registros financeiros: tipo, categoria, descrição, valor e data, para calcular indicadores e mostrar os lançamentos solicitados.',
      'Eventos de auditoria: ação, data/hora e identificadores internos necessários à segurança e rastreabilidade, sem registrar senha, JWT ou chave de API.',
      'Aceite de documentos: versão dos Termos de Uso e da Política de Privacidade e data do registro, para comprovar qual versão foi apresentada.'
    ]
  },
  {
    heading: '3. Dados financeiros e confidencialidade',
    paragraphs: [
      'O sistema não solicita categorias especiais de dados pessoais, como dados de saúde. Informações financeiras são tratadas como confidenciais e, quando relacionadas a uma pessoa natural identificada ou identificável, podem constituir dados pessoais. O projeto aplica minimização, separação por empresa e acesso autenticado; a classificação jurídica de cada campo deverá ser confirmada antes do uso real.'
    ]
  },
  {
    heading: '4. Serviços externos e compartilhamento',
    paragraphs: [
      'O PostgreSQL do projeto fica no Supabase, em schema isolado `gft_inteligente`, com conexão do servidor protegida por TLS e certificado CA. O navegador não recebe credenciais do banco nem chaves de provedores.',
      'A consulta de CNPJ, quando acionada, encaminha o CNPJ informado à ReceitaWS para consulta cadastral. Para insights, somente totais, séries agregadas e categorias controladas são enviados pelo servidor à API Gemini. Não são enviados a essa API nomes, e-mails, CNPJs, descrições livres, IDs de usuário ou da empresa. O uso dos provedores também está sujeito às respectivas condições e políticas.'
    ]
  },
  {
    heading: '5. Segurança e retenção',
    paragraphs: [
      'O protótipo usa bcrypt para senhas, JWT em cookie HttpOnly no fluxo web, validação de autorização no servidor, auditoria e conexão TLS com verificação da CA e do hostname. Nenhuma medida elimina todo risco; por isso, não inclua dados reais ou desnecessários nesta demonstração.',
      'O período de retenção e o procedimento de exclusão devem ser definidos pelo controlador antes do uso externo. No ambiente acadêmico, use dados sintéticos e restrinja o acesso à equipe autorizada.'
    ]
  },
  {
    heading: '6. Direitos e canal de contato',
    paragraphs: [
      'A LGPD prevê direitos do titular, incluindo confirmação e acesso, correção, informação sobre compartilhamento e, nos casos aplicáveis, anonimização, bloqueio ou eliminação. O protótipo ainda não oferece um canal de autoatendimento para essas solicitações. O controlador deve informar um canal de contato e estabelecer procedimento para recebê-las e respondê-las antes do uso com titulares externos.'
    ]
  },
  {
    heading: '7. Atualizações',
    paragraphs: [
      'Esta versão é identificada no cadastro e no registro de aceite. Uma alteração material deve gerar nova versão e solicitar novo aceite ou ciência conforme orientação do responsável e da instituição.'
    ]
  }
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Política de Privacidade"
      version={process.env.PRIVACY_POLICY_VERSION ?? '2026-10-01'}
      sections={sections}
      draftNotice="Minuta acadêmica para apresentação do TCC. O controlador, o canal de contato, o prazo de retenção e o procedimento para exercício de direitos ainda precisam ser definidos. Não use este protótipo com dados reais até concluir essas definições e a revisão adequada."
    />
  );
}
