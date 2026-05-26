import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import {
  getOutdoorNodes,
  createOutdoorNode,
  deleteOutdoorNode
} from './outdoorNodeManager.js';
import { logAction } from '../common/adminLogger.js';


async function loadNodes() {
  await protectPage();
  initAdminHeader();

  const { data } = await getOutdoorNodes();

  const list = document.getElementById('node-list');
  list.innerHTML = '';

  data.forEach(node => {
    const li = document.createElement('li');
    li.innerText = `${node.id} - ${node.name}`;

    li.onclick = async () => {
      await deleteOutdoorNode(node.id);
      loadNodes();
    };

    list.appendChild(li);
  });
}

async function handleCreate() {
  const name = document.getElementById('name').value;
  const lat = parseFloat(document.getElementById('lat').value);
  const lng = parseFloat(document.getElementById('lng').value);

  await createOutdoorNode({ name, lat, lng });
    
  loadNodes();
}

document.getElementById('create-btn').onclick = handleCreate;

loadNodes();