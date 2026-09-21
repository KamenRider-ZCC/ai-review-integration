import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/antd.css';
import App from './App.vue';
import router from './router';
import './styles/global.css';

// 独立联调工程入口；迁入客户仓库时复用客户已有的Vue、Pinia、Router和Ant Design初始化。
createApp(App).use(createPinia()).use(router).use(Antd).mount('#app');
