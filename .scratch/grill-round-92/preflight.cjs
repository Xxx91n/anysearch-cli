const https = require('https');
const fs = require('fs');

async function main() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    console.error('ERROR: DEEPSEEK_API_KEY is not set in environment!');
    process.exit(1);
  }

  console.log('Sending preflight tool_calls request to featherless...');
  const t0 = Date.now();
  const payload = JSON.stringify({
    model: 'Qwen/Qwen3-32B',
    messages: [
      { role: 'user', content: 'Call the search function with query "deepseek dsh".' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'search query',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
          }
        }
      }
    ],
    tool_choice: 'auto',
    max_tokens: 100
  });

  const req = https.request({
    hostname: 'api.featherless.ai',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    }
  }, res => {
    let chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      console.log('Preflight status:', res.statusCode, 'in', (Date.now() - t0), 'ms, length:', raw.length);
      fs.writeFileSync('.scratch/grill-round-92/preflight_raw.json', raw, 'utf8');
      try {
        const json = JSON.parse(raw);
        console.log('JSON parsed successfully!');
        const choice = json.choices?.[0];
        console.log('Finish reason:', choice?.finish_reason);
        console.log('Tool calls:', JSON.stringify(choice?.message?.tool_calls, null, 2));
        console.log('Content:', choice?.message?.content?.slice(0, 100));
      } catch (e) {
        console.log('Parse error:', e.message);
        console.log('Raw sample:', raw.slice(0, 300));
        console.log('End sample:', raw.slice(-300));
      }
    });
  });

  req.on('error', e => console.error('Req error:', e.message));
  req.setTimeout(60000, () => {
    console.error('Request timed out after 60s');
    req.destroy();
  });
  req.write(payload);
  req.end();
}

main();
