const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const outputPath = path.join(__dirname, "..", "manual-vl-adm.pdf");
const doc = new PDFDocument({ size: "A4", margin: 50 });

const writeStream = fs.createWriteStream(outputPath);
doc.pipe(writeStream);

doc.fontSize(22).fillColor("#0057B8").text("Manual VL Adm", { align: "center" });
doc.moveDown(0.5);
doc.fontSize(10).fillColor("#333").text("Manual resumido para o administrador do aplicativo VL Cristal Piscinas & Cia.", { align: "center" });
doc.moveDown(1);

doc.fontSize(14).fillColor("#0057B8").text("1. Acesso e login");
doc.fontSize(11).fillColor("#000").list([
  "Abra o painel administrativo na URL do servidor (por exemplo, http://localhost:3000/admin.html ou rota equivalente).",
  "Use o usuário administrador e senha definidos em ADMIN_PASSWORD no arquivo .env.",
  "Se o login falhar, verifique se o servidor está ativo e se o token JWT está gerando corretamente."
]);
doc.moveDown();

doc.fontSize(14).fillColor("#0057B8").text("2. Funções principais");
doc.fontSize(11).fillColor("#000").list([
  "Clientes: cadastrar, editar e gerenciar dados de contato, endereço, tipo de piscina, acesso ao portal e quantidade de produtos contratados.",
  "Ordens de serviço: registrar cada visita, checklist de serviços realizados, produtos usados e notas técnicas.",
  "Fotos: enviar imagens antes e depois para comprovar serviço e histórico do cliente.",
  "Estoque: acompanhar produtos por cliente, ajustar quantidades e garantir que o estoque mínimo esteja registrado.",
  "Relatórios: gerar relatórios técnicos em PDF por período, cliente ou visita, com checklist, observações, produtos e fotos.",
  "Orçamentos: enviar orçamento pelo WhatsApp diretamente para o número da empresa."
]);
doc.moveDown();

doc.fontSize(14).fillColor("#0057B8").text("3. Sequência correta de uso");
doc.fontSize(11).fillColor("#000").list([
  "1. Iniciar o servidor do app: execute npm install e npm run dev no diretório do projeto.",
  "2. Acessar o admin e fazer login como administrador.",
  "3. Cadastrar ou atualizar clientes no menu Clientes antes de registrar ordens.",
  "4. Criar ordens de serviço quando a equipe atender o cliente, incluindo produtos e notas técnicas.",
  "5. Anexar fotos de antes e depois em cada ordem, quando disponível.",
  "6. Verificar o estoque de cada cliente regularmente e ajustar produtos contratados quando necessário.",
  "7. Gerar relatórios técnicos em PDF e usar o histórico para checar visitas, checklist e consumo de produtos.",
  "8. Enviar orçamentos e mensagens pelo WhatsApp usando o link direto para o número da empresa."
]);
doc.moveDown();

doc.fontSize(14).fillColor("#0057B8").text("4. Erros comuns e o que fazer");

doc.fontSize(11).fillColor("#000").list([
  "Servidor não inicia: verifique se todas as dependências estão instaladas e se a porta não está em uso. Confirme os valores de .env, especialmente ADMIN_PASSWORD, JWT_SECRET, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
  "Erro ao salvar cliente/ordem: confirme campos obrigatórios como nome, telefone, data e serviço. Verifique os logs do servidor para mensagens de SQL ou validação.",
  "Relatório em PDF não abre: confirme se o endpoint /api/reports/pdf está acessível e se o servidor responde. Teste diretamente na URL e confira erros no terminal.",
  "WhatsApp não abre: o navegador pode bloquear pop-ups. Habilite pop-ups para o site ou use o link direto de contato com o número +55 17 98832-0003.",
  "Estoque incorreto: confirme se o produto foi cadastrado e vinculado ao cliente correto, e use o ajuste de estoque para registrar entradas ou correções.",
  "Dados duplicados: use edição em vez de criar novo registro quando atualizar cliente ou ordem existente para evitar duplicatas."
]);
doc.moveDown();

doc.fontSize(14).fillColor("#0057B8").text("5. Dicas rápidas");
doc.fontSize(11).fillColor("#000").list([
  "Mantenha sempre os cadastros de clientes atualizados para facilitar contato e envio de orçamentos.",
  "Utilize a função de relatório para enviar ao cliente o resumo técnico de cada visita.",
  "Guarde o número de WhatsApp da empresa e use o link direto para responder rapidamente aos clientes.",
  "Registre observações técnicas e próxima visita em cada ordem para melhorar o histórico de atendimento."
]);

doc.end();

writeStream.on("finish", () => {
  console.log(`Manual PDF criado em: ${outputPath}`);
});
