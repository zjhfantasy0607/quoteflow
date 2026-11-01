import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// 按需注册统计看板用到的图表与组件（M15），页面从这里取 VChart
use([CanvasRenderer, BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent]);

export { default as VChart } from 'vue-echarts';
