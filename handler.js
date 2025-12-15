'use strict';

const AWS = require('aws-sdk');
const uuid = require('uuid');

// --- CORREÇÃO DE CONEXÃO ---
// Força o endpoint correto e credenciais falsas para o LocalStack aceitar
const localStackConfig = {
  endpoint: process.env.LOCALSTACK_HOSTNAME ? `http://${process.env.LOCALSTACK_HOSTNAME}:4566` : 'http://localhost:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
};

const dynamoDb = new AWS.DynamoDB.DocumentClient(localStackConfig);
const sns = new AWS.SNS(localStackConfig);
const ITEMS_TABLE = process.env.ITEMS_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// Função Auxiliar para enviar respostas HTTP
const response = (statusCode, message) => ({
  statusCode: statusCode,
  body: JSON.stringify(message),
});

// 1. CREATE (Cria item + Valida + Notifica SNS)
module.exports.createItem = async (event) => {
  const data = JSON.parse(event.body);

  // Validação Obrigatória (Roteiro A.4 item 4)
  if (typeof data.nome !== 'string' || typeof data.status !== 'string') {
    return response(400, { error: 'Dados inválidos. "nome" e "status" são obrigatórios.' });
  }

  const params = {
    TableName: ITEMS_TABLE,
    Item: {
      id: uuid.v1(),
      nome: data.nome,
      status: data.status,
      createdAt: new Date().getTime(),
    },
  };

  try {
    // Salva no DynamoDB
    await dynamoDb.put(params).promise();

    // Notificação SNS Obrigatória (Roteiro A.4 item 2)
    const snsParams = {
      Message: `Novo item criado: ${params.Item.nome} (ID: ${params.Item.id})`,
      TopicArn: SNS_TOPIC_ARN,
    };
    await sns.publish(snsParams).promise();

    return response(201, params.Item);
  } catch (error) {
    console.error(error);
    return response(500, { error: 'Não foi possível criar o item' });
  }
};

// 2. READ (Listar todos)
module.exports.listItems = async (event) => {
  try {
    const params = { TableName: ITEMS_TABLE };
    const result = await dynamoDb.scan(params).promise();
    return response(200, result.Items);
  } catch (error) {
    return response(500, { error: 'Erro ao listar itens' });
  }
};

// 3. READ (Buscar por ID)
module.exports.getItem = async (event) => {
  try {
    const params = {
      TableName: ITEMS_TABLE,
      Key: { id: event.pathParameters.id },
    };
    const result = await dynamoDb.get(params).promise();
    
    if (!result.Item) {
      return response(404, { error: 'Item não encontrado' });
    }
    return response(200, result.Item);
  } catch (error) {
    return response(500, { error: 'Erro ao buscar item' });
  }
};

// 4. UPDATE (Atualizar + Notifica SNS)
module.exports.updateItem = async (event) => {
  const data = JSON.parse(event.body);
  const { id } = event.pathParameters;

  // Validação
  if (typeof data.nome !== 'string' || typeof data.status !== 'string') {
    return response(400, { error: 'Dados inválidos para atualização.' });
  }

  const params = {
    TableName: ITEMS_TABLE,
    Key: { id: id },
    UpdateExpression: 'SET nome = :nome, #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':nome': data.nome,
      ':status': data.status,
      ':updatedAt': new Date().getTime(),
    },
    ReturnValues: 'ALL_NEW',
  };

  try {
    const result = await dynamoDb.update(params).promise();
    
    // Notifica SNS na atualização também
    const snsParams = {
      Message: `Item atualizado: ${result.Attributes.nome}`,
      TopicArn: SNS_TOPIC_ARN,
    };
    await sns.publish(snsParams).promise();

    return response(200, result.Attributes);
  } catch (error) {
    return response(500, { error: 'Erro ao atualizar item' });
  }
};

// 5. DELETE (Remover)
module.exports.deleteItem = async (event) => {
  try {
    const params = {
      TableName: ITEMS_TABLE,
      Key: { id: event.pathParameters.id },
    };
    await dynamoDb.delete(params).promise();
    return response(200, { message: 'Item removido com sucesso' });
  } catch (error) {
    return response(500, { error: 'Erro ao deletar item' });
  }
};

// 6. SUBSCRIBER (Ouve o SNS e Loga - Roteiro A.4 item 3)
module.exports.snsListener = async (event) => {
  // O evento SNS vem dentro de 'Records'
  event.Records.forEach((record) => {
    const message = record.Sns.Message;
    console.log(`[SNS LISTENER] Mensagem recebida via tópico: ${message}`);
  });
  return;
};