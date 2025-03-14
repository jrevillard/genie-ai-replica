<template>
  <div class="chart-container">
    <div id="static-chart-container" style="width: 100%; height: 350px;"></div>
    
    <!-- Custom tooltip completely separate from ECharts -->
    <div 
      v-if="showCustomTooltip" 
      class="custom-tooltip" 
      :style="{
        left: tooltipPosition.x + 'px',
        top: tooltipPosition.y + 'px'
      }"
    >
      <div class="tooltip-title">{{ tooltipData.date }}</div>
      <div class="tooltip-item queries">
        <span class="label">Total Queries:</span>
        <span class="value">{{ tooltipData.queries }}</span>
      </div>
      <div class="tooltip-item users">
        <span class="label">Unique Users:</span>
        <span class="value">{{ tooltipData.users }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'UsageTrendChart',
  props: {
    data: {
      type: Array,
      default: () => []
    },
    externalData: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      chartInstance: null,
      showCustomTooltip: false,
      tooltipPosition: { x: 0, y: 0 },
      tooltipData: {
        date: '',
        queries: 0,
        users: 0
      },
      chartData: [], // Processed data for easy lookup
      errorOccurred: false
    };
  },
  mounted() {
    try {
      // Initialize with a delay to ensure DOM is ready
      setTimeout(this.initChart, 300);
    } catch (error) {
      console.error('Error in chart mount:', error);
      this.errorOccurred = true;
    }
  },
  beforeUnmount() {
    try {
      this.destroyChart();
    } catch (error) {
      console.error('Error destroying chart:', error);
    }
  },
  methods: {
    async initChart() {
      try {
        // Find the container element
        const container = document.getElementById('static-chart-container');
        if (!container) {
          console.error('Chart container not found');
          return;
        }

        // Load ECharts with error handling
        let echarts;
        try {
          const echart = await import('echarts');
          echarts = echart.default || echart;
        } catch (error) {
          console.error('Failed to load ECharts library:', error);
          return;
        }
        
        // Process data from props with defensive coding
        const xAxisData = [];
        const queryData = [];
        const userData = [];
        
        // Process data safely using try/catch
        try {
          // Safely use data from props or fallback to sample
          if (Array.isArray(this.data) && this.data.length > 0) {
            this.data.forEach((item, index) => {
              try {
                // Safely extract properties with fallbacks
                const dateLabel = (item && item.dateLabel) ? item.dateLabel : `Day ${index + 1}`;
                const value = (item && typeof item.value === 'number') ? item.value : 0;
                const userCount = (item && typeof item.userCount === 'number') ? item.userCount : 0;
                
                xAxisData.push(dateLabel);
                queryData.push(value);
                userData.push(userCount);
                
                // Store in lookup array for tooltip
                this.chartData.push({
                  date: dateLabel,
                  queries: value,
                  users: userCount
                });
              } catch (itemError) {
                console.error('Error processing data item:', itemError);
                // Add fallback data if item processing fails
                xAxisData.push(`Day ${index + 1}`);
                queryData.push(0);
                userData.push(0);
                this.chartData.push({
                  date: `Day ${index + 1}`,
                  queries: 0,
                  users: 0
                });
              }
            });
          } else {
            // Sample data as fallback
            const dates = [
              'Jun 15', 'Jun 16', 'Jun 17', 'Jun 18', 'Jun 19', 'Jun 20',
              'Jun 21', 'Jun 22', 'Jun 23', 'Jun 24', 'Jun 25', 'Jun 26'
            ];
            
            dates.forEach((date, i) => {
              const queries = 3000 + Math.floor(Math.random() * 1000);
              const users = 150 + Math.floor(Math.random() * 50);
              
              xAxisData.push(date);
              queryData.push(queries);
              userData.push(users);
              
              this.chartData.push({
                date: date,
                queries: queries,
                users: users
              });
            });
          }
        } catch (dataError) {
          console.error('Error processing chart data:', dataError);
          // Ensure we have some data even if processing fails
          for (let i = 0; i < 5; i++) {
            xAxisData.push(`Day ${i + 1}`);
            queryData.push(1000);
            userData.push(100);
            this.chartData.push({
              date: `Day ${i + 1}`,
              queries: 1000,
              users: 100
            });
          }
        }
        
        // Guard against empty data
        if (xAxisData.length === 0) {
          xAxisData.push('No Data');
          queryData.push(0);
          userData.push(0);
          this.chartData.push({
            date: 'No Data',
            queries: 0,
            users: 0
          });
        }
        
        // Get the max values safely
        const maxQuery = Math.max(...queryData.filter(v => typeof v === 'number'), 1);
        const maxUser = Math.max(...userData.filter(v => typeof v === 'number'), 1);
        
        // Create chart instance with explicit renderer and guard against errors
        try {
          this.chartInstance = echarts.init(container, null, {
            renderer: 'canvas'
          });
        } catch (initError) {
          console.error('Failed to initialize chart instance:', initError);
          return;
        }
        
        // Configure chart options WITHOUT any tooltips from ECharts
        try {
          // Create a safe linear gradient factory function
          const safeGradient = (startColor, endColor) => {
            try {
              return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: startColor },
                { offset: 1, color: endColor }
              ]);
            } catch (gradientError) {
              console.error('Error creating gradient:', gradientError);
              return startColor; // Fallback to solid color
            }
          };
          
          const option = {
            animation: false, // Disable animations for better stability
            tooltip: {
              show: false // COMPLETELY DISABLE ECharts tooltips to avoid errors
            },
            grid: {
              left: '3%',
              right: '4%',
              bottom: '12%',
              top: '3%',
              containLabel: true
            },
            xAxis: {
              type: 'category',
              data: xAxisData,
              axisLabel: {
                interval: 0,
                rotate: 45,
                color: '#666',
                fontSize: 10
              },
              axisLine: {
                lineStyle: {
                  color: '#ddd'
                }
              },
              axisTick: {
                show: false
              }
            },
            yAxis: [
              {
                type: 'value',
                min: 0,
                max: Math.ceil(maxQuery * 1.1),
                position: 'left',
                axisLine: {
                  lineStyle: {
                    color: '#ddd'
                  }
                },
                splitLine: {
                  lineStyle: {
                    type: 'dashed',
                    color: '#eee'
                  }
                }
              },
              {
                type: 'value',
                min: 0,
                max: Math.ceil(maxUser * 1.1),
                position: 'right',
                axisLine: {
                  lineStyle: {
                    color: '#ddd'
                  }
                },
                splitLine: {
                  show: false
                }
              }
            ],
            series: [
              {
                name: 'Total Queries',
                type: 'line',
                data: queryData,
                smooth: true,
                showSymbol: true,
                symbol: 'circle',
                symbolSize: 6,
                lineStyle: {
                  width: 2,
                  color: '#5B8FF9'
                },
                itemStyle: {
                  color: '#5B8FF9',
                  borderColor: '#fff',
                  borderWidth: 1
                },
                areaStyle: {
                  color: safeGradient('rgba(91, 143, 249, 0.3)', 'rgba(91, 143, 249, 0.1)')
                }
              },
              {
                name: 'Unique Users',
                type: 'bar',
                yAxisIndex: 1,
                data: userData,
                barWidth: '60%',
                itemStyle: {
                  color: safeGradient('rgba(90, 216, 166, 0.8)', 'rgba(90, 216, 166, 0.3)')
                }
              }
            ],
            legend: {
              data: ['Total Queries', 'Unique Users'],
              bottom: 0,
              icon: 'circle',
              itemWidth: 8,
              itemHeight: 8,
              textStyle: {
                color: '#666'
              }
            }
          };
          
          // Apply chart configuration safely
          this.chartInstance.setOption(option);
        } catch (optionError) {
          console.error('Error setting chart options:', optionError);
          // Try to create a simpler chart as fallback
          try {
            const simpleOption = {
              tooltip: { show: false },
              xAxis: { type: 'category', data: xAxisData },
              yAxis: { type: 'value' },
              series: [{ 
                type: 'line', 
                data: queryData,
                name: 'Total Queries'
              }]
            };
            this.chartInstance.setOption(simpleOption);
          } catch (fallbackError) {
            console.error('Fallback chart failed:', fallbackError);
          }
        }
        
        // Set up manual tooltip with error handling
        this.setupManualTooltip(container);
        
        // Set up resize handler
        try {
          window.addEventListener('resize', this.handleResize);
        } catch (resizeError) {
          console.error('Error setting up resize listener:', resizeError);
        }
      } catch (globalError) {
        console.error('Global chart initialization error:', globalError);
        this.errorOccurred = true;
      }
    },
    
    setupManualTooltip(container) {
      try {
        // Safety check
        if (!container) return;
        
        // Add mouse events for custom tooltip with error handling
        const mouseHandler = (event) => {
          try {
            const rect = container.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            
            // Only show tooltip if mouse is in the chart area (not in margins/legends)
            if (y > 10 && y < rect.height - 30) {
              // Calculate which data point we're nearest to (with bounds checking)
              const dataLength = this.chartData.length || 1;
              const index = Math.min(
                Math.max(0, Math.floor(x / (rect.width / dataLength))),
                dataLength - 1
              );
              
              if (index >= 0 && index < this.chartData.length) {
                // Update tooltip data
                this.tooltipData = {
                  date: this.chartData[index].date || 'N/A',
                  queries: this.chartData[index].queries || 0,
                  users: this.chartData[index].users || 0
                };
                
                // Position tooltip - keep it within bounds
                let tooltipX = x + 10; // 10px right of cursor
                if (tooltipX + 150 > rect.width) {
                  tooltipX = x - 160; // Switch to left side if too close to right edge
                }
                
                this.tooltipPosition = {
                  x: Math.max(0, tooltipX),
                  y: Math.max(10, y - 70) // Position above cursor, but not too high
                };
                
                this.showCustomTooltip = true;
              }
            } else {
              this.showCustomTooltip = false;
            }
          } catch (error) {
            console.error('Error in tooltip mouse handler:', error);
            this.showCustomTooltip = false;
          }
        };
        
        const leaveHandler = () => {
          try {
            this.showCustomTooltip = false;
          } catch (error) {
            console.error('Error in mouse leave handler:', error);
          }
        };
        
        container.addEventListener('mousemove', mouseHandler);
        container.addEventListener('mouseleave', leaveHandler);
        
        // Store handlers for cleanup
        this._mouseHandler = mouseHandler;
        this._leaveHandler = leaveHandler;
      } catch (error) {
        console.error('Error setting up manual tooltip:', error);
      }
    },
    
    handleResize() {
      try {
        if (this.chartInstance) {
          this.chartInstance.resize();
        }
      } catch (error) {
        console.error('Error resizing chart:', error);
      }
    },
    
    destroyChart() {
      try {
        // Remove event listeners if they exist
        const container = document.getElementById('static-chart-container');
        if (container) {
          if (this._mouseHandler) {
            container.removeEventListener('mousemove', this._mouseHandler);
          }
          if (this._leaveHandler) {
            container.removeEventListener('mouseleave', this._leaveHandler);
          }
        }
        
        window.removeEventListener('resize', this.handleResize);
        
        if (this.chartInstance) {
          this.chartInstance.dispose();
          this.chartInstance = null;
        }
      } catch (error) {
        console.error('Error cleaning up chart:', error);
      }
    }
  }
};
</script>

<style scoped>
.chart-container {
  position: relative;
  width: 100%;
  height: 350px;
}

#static-chart-container {
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.custom-tooltip {
  position: absolute;
  z-index: 100;
  background-color: rgba(255, 255, 255, 0.95);
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 12px;
  min-width: 150px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  pointer-events: none;
}

.tooltip-title {
  font-weight: 600;
  color: #333;
  margin-bottom: 5px;
  text-align: center;
}

.tooltip-item {
  display: flex;
  justify-content: space-between;
  margin: 5px 0;
  padding: 2px 0;
}

.tooltip-item .label {
  margin-right: 15px;
}

.tooltip-item .value {
  font-weight: 600;
}

.tooltip-item.queries .label {
  color: #5B8FF9;
}

.tooltip-item.users .label {
  color: #5AD8A6;
}
</style>
