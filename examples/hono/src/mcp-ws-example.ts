import { createMCPClient } from 'ai/core/tool/mcp/mcp-client';

async function main() {
  try {
    console.log('正在连接到 MCP WebSocket 服务器...');
    
    // 创建 MCP 客户端，使用 WebSocket 传输
    const client = await createMCPClient({
      transport: {
        type: 'ws',
        url: 'ws://localhost:8080', // 你的 MCP WebSocket 服务器地址
        headers: {
          // 可选：添加认证头等
          'Authorization': 'Bearer your-token',
        },
      },
      onUncaughtError: error => {
        console.error('MCP 客户端错误：', error);
      },
    });

    console.log('已成功连接到 MCP WebSocket 服务器');

    // 获取工具列表
    const tools = await client.tools();
    console.log('可用工具：', Object.keys(tools));

    // 调用示例工具
    if ('example' in tools) {
      const result = await tools.example.execute({ 
        param1: 'hello', 
        param2: 'world' 
      }, {
        toolCallId: 'example-call-1',
        messages: [], // 这里应该包含导致工具调用的消息历史
        abortSignal: undefined,
      });
      console.log('工具执行结果：', result);
    }

    // 关闭客户端
    await client.close();
    console.log('已关闭 MCP 客户端连接');
  } catch (error) {
    console.error('发生错误：', error);
  }
}

main(); 